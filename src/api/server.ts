import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { telemetryToLightningSnapshot } from "../connectors/frontendTelemetry";
import { getLightningSnapshot } from "../connectors/lightningSnapshot";
import { getMockLightningSnapshot } from "../connectors/mockLightningSnapshot";
import type { FrontendTelemetryEnvelope, LightningSnapshot } from "../connectors/types";
import { normalizeSnapshot } from "../normalization/normalizeSnapshot";
import type { NormalizedNodeState } from "../normalization/types";
import {
  applyPrivacyPolicy,
  type PrivacyMode,
  type PrivacyTransformedNodeState,
} from "../privacy/applyPrivacyPolicy";
import { scoreNodeState } from "../scoring/scoreNodeState";
import { generateSourceProvenanceReceipt, type SourceProvenanceReceipt } from "../arb/provenance";
import { buildArb, type ArbBundle } from "../arb/buildArb";
import { verifyArb } from "../arb/verifyArb";

type SnapshotMode = "lnc" | "mock" | "frontend_payload";

interface SnapshotResponse {
  ok: true;
  mode: SnapshotMode;
  rawSnapshotPath: string;
  normalizedSnapshotPath: string;
  provenancePath: string;
  rawSnapshot: LightningSnapshot;
  normalizedSnapshot: NormalizedNodeState;
  provenance: SourceProvenanceReceipt;
}

interface RecommendResponse {
  ok: true;
  mode: SnapshotMode;
  privacyMode: PrivacyMode;
  recommendationPath: string;
  arbPath: string;
  privacyPath: string;
  provenancePath: string;
  recommendation: ReturnType<typeof scoreNodeState>;
  privacyTransformedNodeState: PrivacyTransformedNodeState;
  sourceProvenance: SourceProvenanceReceipt;
  arb: ArbBundle;
}

const DEFAULT_DEV_SIGNING_KEY = "arb-dev-signing-key-insecure";
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }

  return value;
};

const writeJsonDeterministic = async (outputPath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = JSON.stringify(sortObjectKeysDeep(value), null, 2);
  await writeFile(outputPath, `${payload}\n`, "utf8");
};

const parseBody = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  throw new Error("Request body must be a JSON object.");
};

const sendJson = (res: http.ServerResponse, statusCode: number, payload: unknown): void => {
  res.writeHead(statusCode, API_HEADERS);
  res.end(JSON.stringify(sortObjectKeysDeep(payload), null, 2));
};

const toSnapshotMode = (value: unknown): SnapshotMode => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "mock") return "mock";
  }
  if (process.env.LIGHTNING_SNAPSHOT_MODE?.trim().toLowerCase() === "mock") return "mock";
  return "lnc";
};

const readFrontendTelemetry = (value: unknown): FrontendTelemetryEnvelope | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const typed = value as Record<string, unknown>;
  if (typed.schemaVersion !== "frontend-telemetry-envelope-v1") return null;
  return typed as FrontendTelemetryEnvelope;
};

const toPrivacyMode = (value: unknown): PrivacyMode => {
  if (typeof value !== "string") return "feature_only";
  const normalized = value.trim().toLowerCase();
  if (normalized === "full_internal") return "full_internal";
  if (normalized === "feature_only") return "feature_only";
  if (normalized === "banded") return "banded";
  return "feature_only";
};

const ensureRelativeArtifactPath = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Path must be a non-empty string.");
  }
  const normalized = value.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Path must be a safe relative path under the project directory.");
  }
  return normalized;
};

const resolveSnapshot = async (
  mode: SnapshotMode,
  telemetry: FrontendTelemetryEnvelope | null
): Promise<LightningSnapshot> => {
  if (telemetry) return telemetryToLightningSnapshot(telemetry);
  if (mode === "mock") return getMockLightningSnapshot();
  return getLightningSnapshot();
};

const buildSnapshotBundle = async (
  mode: SnapshotMode,
  telemetry: FrontendTelemetryEnvelope | null
): Promise<SnapshotResponse> => {
  const rawSnapshot = await resolveSnapshot(mode, telemetry);
  const normalizedSnapshot = normalizeSnapshot(rawSnapshot);
  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalizedSnapshot);

  const rawSnapshotPath = path.resolve(process.cwd(), "artifacts", "lightning-snapshot.raw.json");
  const normalizedSnapshotPath = path.resolve(process.cwd(), "artifacts", "lightning-snapshot.normalized.json");
  const provenancePath = path.resolve(process.cwd(), "artifacts", "source-provenance.json");

  await writeJsonDeterministic(rawSnapshotPath, rawSnapshot);
  await writeJsonDeterministic(normalizedSnapshotPath, normalizedSnapshot);
  await writeJsonDeterministic(provenancePath, provenance);

  return {
    ok: true,
    mode,
    rawSnapshotPath,
    normalizedSnapshotPath,
    provenancePath,
    rawSnapshot,
    normalizedSnapshot,
    provenance,
  };
};

const buildRecommendationBundle = async (
  mode: SnapshotMode,
  privacyMode: PrivacyMode,
  telemetry: FrontendTelemetryEnvelope | null,
  issuedAtOverride?: string
): Promise<RecommendResponse> => {
  const snapshotBundle = await buildSnapshotBundle(mode, telemetry);
  const featureOnlyModelInput = applyPrivacyPolicy(snapshotBundle.normalizedSnapshot, "feature_only");
  const privacyTransformedNodeState =
    privacyMode === "feature_only"
      ? featureOnlyModelInput
      : applyPrivacyPolicy(snapshotBundle.normalizedSnapshot, privacyMode as any);
  const recommendation = scoreNodeState(featureOnlyModelInput, {
    nodePubkey: snapshotBundle.normalizedSnapshot.nodePubkey,
    nodeAlias: snapshotBundle.normalizedSnapshot.nodeAlias,
    collectedAt: snapshotBundle.normalizedSnapshot.collectedAt,
  });
  const provenance = generateSourceProvenanceReceipt(
    snapshotBundle.rawSnapshot,
    snapshotBundle.normalizedSnapshot,
    {
      privacyTransformedSnapshot: featureOnlyModelInput,
    }
  );

  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: process.env.ARB_DEV_SIGNING_KEY?.trim() || DEFAULT_DEV_SIGNING_KEY,
    issuedAt:
      issuedAtOverride?.trim() ||
      process.env.ARB_ISSUED_AT?.trim() ||
      new Date().toISOString(),
  });

  const recommendationPath = path.resolve(process.cwd(), "artifacts", "recommendations.v1.json");
  const arbPath = path.resolve(process.cwd(), "artifacts", "recommendation-bundle.arb.json");
  const provenancePath = path.resolve(process.cwd(), "artifacts", "source-provenance.json");
  const privacyPath = path.resolve(
    process.cwd(),
    "artifacts",
    privacyMode === "banded" ? "node-state.banded.json" : "node-state.feature-only.json"
  );

  await writeJsonDeterministic(recommendationPath, recommendation);
  await writeJsonDeterministic(arbPath, arb);
  await writeJsonDeterministic(provenancePath, provenance);
  await writeJsonDeterministic(privacyPath, privacyTransformedNodeState);

  return {
    ok: true,
    mode,
    privacyMode,
    recommendationPath,
    arbPath,
    privacyPath,
    provenancePath,
    recommendation,
    privacyTransformedNodeState,
    sourceProvenance: provenance,
    arb,
  };
};

export function createApiServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, API_HEADERS);
        res.end();
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Only POST is supported." });
        return;
      }

      const url = new URL(req.url || "/", "http://localhost");
      const body = await parseBody(req);
      const telemetry = readFrontendTelemetry(body.telemetry);
      const mode = telemetry ? "frontend_payload" : toSnapshotMode(body.mode);

      if (url.pathname === "/api/snapshot") {
        const snapshotResponse = await buildSnapshotBundle(mode, telemetry);
        sendJson(res, 200, snapshotResponse);
        return;
      }

      if (url.pathname === "/api/recommend") {
        const privacyMode = toPrivacyMode(body.privacyMode);
        const issuedAt = typeof body.issuedAt === "string" ? body.issuedAt : undefined;
        const recommendResponse = await buildRecommendationBundle(mode, privacyMode, telemetry, issuedAt);
        sendJson(res, 200, recommendResponse);
        return;
      }

      if (url.pathname === "/api/verify") {
        const arb = body.arb as ArbBundle | undefined;
        const provenance = body.sourceProvenance as SourceProvenanceReceipt | undefined;
        const devSigningKey = typeof body.devSigningKey === "string" ? body.devSigningKey.trim() : undefined;
        const now = body.now as string | number | Date | undefined;

        const arbPathValue = body.arbPath;
        const provenancePathValue = body.sourceProvenancePath;

        const loadedArb = arb
          ? arb
          : arbPathValue
            ? (JSON.parse(
              await readFile(path.resolve(process.cwd(), ensureRelativeArtifactPath(arbPathValue)), "utf8")
            ) as ArbBundle)
            : null;
        if (!loadedArb) {
          sendJson(res, 400, { ok: false, error: "Provide arb object or arbPath." });
          return;
        }

        const loadedProvenance = provenance
          ? provenance
          : provenancePathValue
            ? (JSON.parse(
              await readFile(
                path.resolve(process.cwd(), ensureRelativeArtifactPath(provenancePathValue)),
                "utf8"
              )
            ) as SourceProvenanceReceipt)
            : undefined;

        const verifyResult = verifyArb({
          arb: loadedArb,
          sourceProvenance: loadedProvenance,
          devSigningKey,
          now,
        });

        sendJson(res, 200, verifyResult);
        return;
      }

      if (url.pathname === "/api/analyze-gemini") {
        const telemetry = body.telemetry;
        const recommendation = body.recommendation;

        if (!telemetry || !recommendation) {
          sendJson(res, 400, { ok: false, error: "Provide telemetry and recommendation objects." });
          return;
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          sendJson(res, 500, { ok: false, error: "GEMINI_API_KEY environment variable is not set." });
          return;
        }

        const ai = new GoogleGenAI({ apiKey });

        try {
          const result = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `
              You are a Lightning Network expert advisor. 
              Given the following telemetry data for a channel and the suggested fee recommendation, 
              evaluate if the recommendation makes sense.
              
              Telemetry:
              ${JSON.stringify(telemetry, null, 2)}
              
              Recommendation:
              ${JSON.stringify(recommendation, null, 2)}
              
              Provide a brief analysis (max 3 sentences) explaining why you agree or disagree with the recommendation.
              Focus on liquidity imbalance, recent forward activity, and peer context.
            `
          });

          sendJson(res, 200, { ok: true, analysis: result.text });
        } catch (err) {
          console.error("Gemini analysis failed:", err);
          sendJson(res, 500, { ok: false, error: "Gemini analysis failed: " + (err instanceof Error ? err.message : String(err)) });
        }
        return;
      }

      sendJson(res, 404, { ok: false, error: `Unknown endpoint: ${url.pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown API error.";
      sendJson(res, 500, { ok: false, error: message });
    }
  });
}

export function startApiServer(port: number): http.Server {
  const server = createApiServer();
  server.listen(port);
  return server;
}
