import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
import { DEFAULT_PINNED_MODEL_MANIFEST } from "../scoring/modelManifest";
import { generateSourceProvenanceReceipt, type SourceProvenanceReceipt } from "../arb/provenance";
import { buildArb, type ArbBundle } from "../arb/buildArb";
import { verifyArb } from "../arb/verifyArb";
import { verifyTrustedBundle } from "../arb/verifyTrustedBundle";
import { runEnclaveBoundaryPipeline, type EnclavePipelineRunSummary } from "../arb/enclave/pipeline";
import type { EnclaveExecutionMode } from "../arb/attestation";
import type { ArbAttestationQuoteFormat } from "../arb/attestation";
import type { AttestationPolicy } from "../arb/attestationPolicy";
import type { KeyReleasePolicy } from "../arb/keyReleasePolicy";
import { StaticKeyringSigningKeyProvider } from "../arb/enclave/signingKeyProvider";
import {
  localDevEnclaveProvider,
  simulatedTeeEnclaveProvider,
  verifiedTeeEnclaveProvider,
  type EnclaveProvider,
} from "../arb/enclave/provider";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../arb/enclave/phalaCliProvider";
import {
  createEnvSourceVerificationRuntime,
  type ApiSourceVerificationRuntime,
} from "./sourceVerification";
import { applyRetentionPolicy, resolveRetentionMode, type RetentionMode, type RetentionSummary } from "./retention";
import { createTrainingContributionReceipt, type TrainingContributionReceipt } from "./trainingContribution";
import type { VerifyPhalaAttestationBySourceResult } from "../tee/phala";
import {
  createConditionalRecallSessionManager,
} from "../cr/sessionManager";
import { createMockConditionalRecallSessionManager } from "../cr/mockConditionalRecall";
import { conditionalRecallServerDebugLog } from "../cr/serverDebug";
import type {
  ConditionalRecallChannelHint,
  ConditionalRecallConfig,
  ConditionalRecallRouterConfig,
  ConditionalRecallSessionManager,
} from "../cr/types";

type SnapshotMode = "lnc" | "mock" | "frontend_payload";

// Builds a minimal but structurally valid SourceProvenanceReceipt for PROPS-only
// routes where we never see raw telemetry. We hash the already-privacy-filtered
// payload and use that as privacyTransformedSnapshotHash, which is all buildArb needs.
const buildPropsProvenance = (propsPayload: unknown, collectedAt: string): SourceProvenanceReceipt => {
  const canonical = JSON.stringify(propsPayload);
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  return {
    schemaVersion: "source-provenance-receipt-v1",
    sourceType: "lnc_frontend_extractor",
    snapshotTimestamp: collectedAt,
    nodeIdentifier: "props-shielded",
    rawSnapshotHash: payloadHash,           // no raw snapshot; use props hash as placeholder
    normalizedSnapshotHash: payloadHash,    // same — props payload is the only data we have
    privacyTransformedSnapshotHash: payloadHash, // this is what buildArb uses as inputHash
    graphSnapshotRef: null,
    executionContext: {
      schemaVersion: "source-execution-context-v1",
      executionMode: "host_local",
      enclaveProviderId: null,
      attestationHash: null,
    },
  };
};


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
  signingMode: "dev_key" | "released_signer";
  recommendationPath: string;
  arbPath: string;
  privacyPath: string;
  provenancePath: string;
  recommendation: ReturnType<typeof scoreNodeState>;
  privacyTransformedNodeState: PrivacyTransformedNodeState;
  sourceProvenance: SourceProvenanceReceipt;
  arb: ArbBundle;
  retention: RetentionSummary;
  trainingContribution: TrainingContributionReceipt | null;
  enclaveRunSummary?: EnclavePipelineRunSummary;
}

export interface ApiServerOptions {
  sourceVerificationRuntime?: ApiSourceVerificationRuntime;
  conditionalRecallSessionManager?: ConditionalRecallSessionManager;
}

const DEFAULT_DEV_SIGNING_KEY = "arb-dev-signing-key-insecure";
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const DEFAULT_RELEASED_SIGNER_ENCLAVE_PROVIDER = "verified_tee";
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

interface ReleasedSignerRuntimeConfig {
  keyReleasePolicy: KeyReleasePolicy;
  signingKeyProvider: StaticKeyringSigningKeyProvider;
  enclaveProvider: EnclaveProvider;
}

const parseBooleanEnv = (value: string | undefined): boolean =>
  value !== undefined && TRUTHY_ENV_VALUES.has(value.trim().toLowerCase());

const isReleasedSignerModeEnabled = (): boolean =>
  parseBooleanEnv(process.env.API_REQUIRE_RELEASED_SIGNER);

const readRequiredEnv = (name: string): string => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return raw.trim();
};

const parseCsvEnv = (value: string | undefined): string[] | undefined => {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
};

const parseExecutionModeEnv = (value: string | undefined, fallback: EnclaveExecutionMode): EnclaveExecutionMode => {
  if (!value || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "local_dev") return "local_dev";
  if (normalized === "tee_simulated") return "tee_simulated";
  if (normalized === "tee_verified") return "tee_verified";
  throw new Error(`Unsupported execution mode: ${value}`);
};

const parseQuoteFormatsEnv = (
  value: string | undefined
): ArbAttestationQuoteFormat[] | undefined => {
  const parsed = parseCsvEnv(value);
  if (!parsed) return undefined;
  const out: ArbAttestationQuoteFormat[] = [];
  for (const item of parsed) {
    const normalized = item.toLowerCase();
    if (normalized === "simulated_quote") {
      out.push("simulated_quote");
      continue;
    }
    if (normalized === "tdx_quote") {
      out.push("tdx_quote");
      continue;
    }
    throw new Error(`Unsupported quote format: ${item}`);
  }
  return out;
};

const parseKeyringJsonEnv = (raw: string): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in API_RELEASED_SIGNER_KEYRING_JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("API_RELEASED_SIGNER_KEYRING_JSON must be a JSON object map of keyId -> keyMaterial.");
  }

  const input = parsed as Record<string, unknown>;
  const keyring: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const keyId = key.trim();
    const keyMaterial = typeof value === "string" ? value.trim() : "";
    if (!keyId || !keyMaterial) continue;
    keyring[keyId] = keyMaterial;
  }
  if (Object.keys(keyring).length === 0) {
    throw new Error("API_RELEASED_SIGNER_KEYRING_JSON must contain at least one non-empty keyId -> keyMaterial pair.");
  }
  return keyring;
};

const resolveReleasedSignerEnclaveProvider = async (): Promise<EnclaveProvider> => {
  const mode = (
    process.env.API_RELEASED_SIGNER_ENCLAVE_PROVIDER?.trim().toLowerCase() ||
    DEFAULT_RELEASED_SIGNER_ENCLAVE_PROVIDER
  );

  if (mode === "local_dev") return localDevEnclaveProvider;
  if (mode === "simulated_tee") return simulatedTeeEnclaveProvider;
  if (mode === "verified_tee") return verifiedTeeEnclaveProvider;

  if (mode === "phala_cli") {
    const cvmInfoPath = path.resolve(
      process.cwd(),
      process.env.API_PHALA_CVM_INFO_PATH?.trim() || path.join("artifacts", "phala-jupyter.cvm.json")
    );
    const cliAttestationPath = path.resolve(
      process.cwd(),
      process.env.API_PHALA_CLI_ATTEST_PATH?.trim() ||
        path.join("artifacts", "phala-jupyter.attestation.cli.json")
    );
    const providerId = process.env.API_RELEASED_SIGNER_ENCLAVE_PROVIDER_ID?.trim();
    return createPhalaCliEnclaveProviderFromArtifacts({
      cvmInfoPath,
      cliAttestationPath,
      providerId: providerId || undefined,
    });
  }

  throw new Error(
    "Unsupported API_RELEASED_SIGNER_ENCLAVE_PROVIDER value. Use one of: verified_tee, simulated_tee, local_dev, phala_cli."
  );
};

const resolveReleasedSignerRuntimeConfig = async (): Promise<ReleasedSignerRuntimeConfig> => {
  const keyId = readRequiredEnv("API_RELEASED_SIGNER_KEY_ID");
  const keyring = parseKeyringJsonEnv(readRequiredEnv("API_RELEASED_SIGNER_KEYRING_JSON"));
  const signingKeyProvider = new StaticKeyringSigningKeyProvider({
    keyring,
    providerId:
      process.env.API_RELEASED_SIGNER_KEY_PROVIDER_ID?.trim() || "api-released-signer-key-provider-v1",
  });

  const enclaveProvider = await resolveReleasedSignerEnclaveProvider();
  const minExecutionMode = parseExecutionModeEnv(
    process.env.API_RELEASED_SIGNER_MIN_EXECUTION_MODE,
    "tee_verified"
  );
  const allowedProviderIds =
    parseCsvEnv(process.env.API_RELEASED_SIGNER_ALLOWED_PROVIDER_IDS) || [enclaveProvider.providerId];
  const allowedMeasurements = parseCsvEnv(process.env.API_RELEASED_SIGNER_ALLOWED_MEASUREMENTS);
  const allowedQuoteFormats = parseQuoteFormatsEnv(process.env.API_RELEASED_SIGNER_ALLOWED_QUOTE_FORMATS);

  const keyReleasePolicy: KeyReleasePolicy = {
    schemaVersion: "key-release-policy-v1",
    keyId,
    minExecutionMode,
    requireAttestation: true,
    ...(allowedProviderIds ? { allowedProviderIds } : {}),
    ...(allowedMeasurements ? { allowedMeasurements } : {}),
    ...(allowedQuoteFormats ? { allowedQuoteFormats } : {}),
  };

  return {
    keyReleasePolicy,
    signingKeyProvider,
    enclaveProvider,
  };
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
  return typed as unknown as FrontendTelemetryEnvelope;
};

const toPrivacyMode = (value: unknown): PrivacyMode => {
  if (typeof value !== "string") return "feature_only";
  const normalized = value.trim().toLowerCase();
  if (normalized === "full_internal") return "full_internal";
  if (normalized === "feature_only") return "feature_only";
  if (normalized === "banded") return "banded";
  return "feature_only";
};

const toRetentionMode = (value: unknown): RetentionMode => {
  if (typeof value === "string") return resolveRetentionMode(value);
  return resolveRetentionMode(process.env.API_RETENTION_MODE);
};

const toBooleanOrUndefined = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const parseAttestationPolicy = (value: unknown): AttestationPolicy | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const typed = value as Record<string, unknown>;
  if (typed.schemaVersion !== "attestation-policy-v1") return undefined;

  const minExecutionMode =
    typed.minExecutionMode === "local_dev" ||
    typed.minExecutionMode === "tee_simulated" ||
    typed.minExecutionMode === "tee_verified"
      ? typed.minExecutionMode
      : null;
  if (!minExecutionMode) {
    throw new Error("Invalid attestationPolicy.minExecutionMode.");
  }

  return {
    schemaVersion: "attestation-policy-v1",
    minExecutionMode,
    requireAttestation: typed.requireAttestation === true,
    ...(Array.isArray(typed.allowedProviderIds)
      ? { allowedProviderIds: typed.allowedProviderIds.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(Array.isArray(typed.allowedMeasurements)
      ? { allowedMeasurements: typed.allowedMeasurements.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(Array.isArray(typed.allowedQuoteFormats)
      ? {
          allowedQuoteFormats: typed.allowedQuoteFormats.filter(
            (value): value is ArbAttestationQuoteFormat =>
              value === "simulated_quote" || value === "tdx_quote"
          ),
        }
      : {}),
  };
};

const parseSourceVerification = (value: unknown): VerifyPhalaAttestationBySourceResult | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const typed = value as Record<string, unknown>;
  if (typed.schemaVersion !== "phala-attestation-source-verification-v1") return undefined;
  return typed as VerifyPhalaAttestationBySourceResult;
};

const resolveVerifyPolicyProfile = (
  profile: unknown,
  arb: ArbBundle
): {
  attestationPolicy?: AttestationPolicy;
  requireSourceVerification?: boolean;
  requireSourceVerificationOk?: boolean;
} => {
  if (typeof profile !== "string") return {};
  const normalized = profile.trim().toLowerCase();
  if (!normalized || normalized === "dev") return {};
  if (normalized !== "strict") {
    throw new Error(`Unsupported trustPolicyProfile: ${profile}`);
  }

  return {
    attestationPolicy: {
      schemaVersion: "attestation-policy-v1",
      minExecutionMode: "tee_verified",
      requireAttestation: true,
      ...(arb.attestation?.providerId ? { allowedProviderIds: [arb.attestation.providerId] } : {}),
      ...(arb.attestation?.measurement ? { allowedMeasurements: [arb.attestation.measurement] } : {}),
      ...(arb.attestation?.quoteFormat ? { allowedQuoteFormats: [arb.attestation.quoteFormat] } : {}),
    },
    requireSourceVerification: true,
    requireSourceVerificationOk: true,
  };
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

const readStringField = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const readNumberField = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const parseConditionalRecallRouterConfig = (value: unknown): ConditionalRecallRouterConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Conditional Recall requires routerConfig.");
  }
  const typed = value as Record<string, unknown>;
  const restHost = readStringField(typed.restHost);
  const macaroonHex = readStringField(typed.macaroonHex);
  if (!restHost) {
    throw new Error("Conditional Recall requires routerConfig.restHost.");
  }
  if (!macaroonHex) {
    throw new Error("Conditional Recall requires routerConfig.macaroonHex.");
  }
  return {
    restHost,
    macaroonHex,
    allowSelfSigned: typed.allowSelfSigned === true,
  };
};

const parseConditionalRecallChannelHints = (value: unknown): ConditionalRecallChannelHint[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((hint) => {
      if (!hint || typeof hint !== "object" || Array.isArray(hint)) return null;
      const typed = hint as Record<string, unknown>;
      const channelId = readStringField(typed.channelId);
      if (!channelId) return null;
      const channelRef = readStringField(typed.channelRef) || "unmapped_channel_0000";
      const currentFeePpmRaw = typed.currentFeePpm;
      const currentFeePpm =
        currentFeePpmRaw === null || currentFeePpmRaw === undefined || currentFeePpmRaw === ""
          ? null
          : readNumberField(currentFeePpmRaw, 0);
      return {
        channelId,
        channelRef,
        currentFeePpm,
      };
    })
    .filter((hint): hint is ConditionalRecallChannelHint => Boolean(hint));
};

const parseConditionalRecallConfig = (body: Record<string, unknown>): ConditionalRecallConfig => ({
  routerConfig: parseConditionalRecallRouterConfig(body.routerConfig),
  lookbackDays: readNumberField(body.lookbackDays, 14),
  liveWindowSeconds: readNumberField(body.liveWindowSeconds, 300),
  channelHints: parseConditionalRecallChannelHints(body.channelHints),
});

const matchConditionalRecallSessionPath = (
  pathname: string
): { sessionId: string; isResultPath: boolean } | null => {
  const resultMatch = pathname.match(/^\/api\/cr\/sessions\/([^/]+)\/result$/);
  if (resultMatch) {
    return { sessionId: decodeURIComponent(resultMatch[1]), isResultPath: true };
  }
  const statusMatch = pathname.match(/^\/api\/cr\/sessions\/([^/]+)$/);
  if (statusMatch) {
    return { sessionId: decodeURIComponent(statusMatch[1]), isResultPath: false };
  }
  return null;
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
  issuedAtOverride?: string,
  retentionMode: RetentionMode = "none",
  options: ApiServerOptions = {}
): Promise<RecommendResponse> => {
  const snapshotBundle = await buildSnapshotBundle(mode, telemetry);
  const recommendationPath = path.resolve(process.cwd(), "artifacts", "recommendations.v1.json");
  const arbPath = path.resolve(process.cwd(), "artifacts", "recommendation-bundle.arb.json");
  const provenancePath = path.resolve(process.cwd(), "artifacts", "source-provenance.json");
  const privacyPath = path.resolve(
    process.cwd(),
    "artifacts",
    privacyMode === "banded" ? "node-state.banded.json" : "node-state.feature-only.json"
  );

  const issuedAt =
    issuedAtOverride?.trim() ||
    process.env.ARB_ISSUED_AT?.trim() ||
    new Date().toISOString();

  const ttlSecondsRaw = process.env.ARB_TTL_SECONDS?.trim();
  const parsedTtlSeconds = ttlSecondsRaw ? Number.parseInt(ttlSecondsRaw, 10) : Number.NaN;
  const ttlSeconds =
    Number.isFinite(parsedTtlSeconds) && parsedTtlSeconds > 0
      ? parsedTtlSeconds
      : undefined;

  if (isReleasedSignerModeEnabled()) {
    const releasedSignerConfig = await resolveReleasedSignerRuntimeConfig();
    const sourceVerificationRuntime =
      options.sourceVerificationRuntime ?? createEnvSourceVerificationRuntime();
    const sourceVerificationResult = await sourceVerificationRuntime.resolve();
    const pipelineResult = await runEnclaveBoundaryPipeline({
      rawSnapshot: snapshotBundle.rawSnapshot,
      privacyMode,
      devSigningKey: process.env.ARB_DEV_SIGNING_KEY?.trim() || DEFAULT_DEV_SIGNING_KEY,
      requireReleasedSigningKey: true,
      keyReleasePolicy: releasedSignerConfig.keyReleasePolicy,
      signingKeyProvider: releasedSignerConfig.signingKeyProvider,
      enclaveProvider: releasedSignerConfig.enclaveProvider,
      sourceVerificationResult,
      attestationVerificationGatePolicy: sourceVerificationRuntime.gatePolicy,
      modelManifest: DEFAULT_PINNED_MODEL_MANIFEST,
      issuedAt,
      ttlSeconds,
    });

    await writeJsonDeterministic(recommendationPath, pipelineResult.recommendation);
    await writeJsonDeterministic(arbPath, pipelineResult.arb);
    await writeJsonDeterministic(provenancePath, pipelineResult.sourceProvenance);
    await writeJsonDeterministic(privacyPath, pipelineResult.privacyTransformedNodeState);
    const retention = await applyRetentionPolicy({
      normalizedSnapshot: snapshotBundle.normalizedSnapshot,
      retentionMode,
    });

    return {
      ok: true,
      mode,
      privacyMode,
      signingMode: "released_signer",
      recommendationPath,
      arbPath,
      privacyPath,
      provenancePath,
      recommendation: pipelineResult.recommendation,
      privacyTransformedNodeState: pipelineResult.privacyTransformedNodeState,
      sourceProvenance: pipelineResult.sourceProvenance,
      arb: pipelineResult.arb,
      retention,
      trainingContribution: await createTrainingContributionReceipt({
        retention,
        sourceProvenance: pipelineResult.sourceProvenance,
        modelManifestHash: pipelineResult.arb.modelManifestHash,
        contributedAt: issuedAt,
      }),
      enclaveRunSummary: pipelineResult.runSummary,
    };
  }

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
      modelManifest: DEFAULT_PINNED_MODEL_MANIFEST,
      privacyTransformedSnapshot: featureOnlyModelInput,
    }
  );

  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: process.env.ARB_DEV_SIGNING_KEY?.trim() || DEFAULT_DEV_SIGNING_KEY,
    modelManifest: DEFAULT_PINNED_MODEL_MANIFEST,
    issuedAt,
    ttlSeconds,
  });

  await writeJsonDeterministic(recommendationPath, recommendation);
  await writeJsonDeterministic(arbPath, arb);
  await writeJsonDeterministic(provenancePath, provenance);
  await writeJsonDeterministic(privacyPath, privacyTransformedNodeState);
  const retention = await applyRetentionPolicy({
    normalizedSnapshot: snapshotBundle.normalizedSnapshot,
    retentionMode,
  });

  return {
    ok: true,
    mode,
    privacyMode,
    signingMode: "dev_key",
    recommendationPath,
    arbPath,
    privacyPath,
    provenancePath,
    recommendation,
    privacyTransformedNodeState,
    sourceProvenance: provenance,
    arb,
    retention,
    trainingContribution: await createTrainingContributionReceipt({
      retention,
      sourceProvenance: provenance,
      modelManifestHash: arb.modelManifestHash,
      contributedAt: issuedAt,
    }),
  };
};

export function createApiServer(options: ApiServerOptions = {}): http.Server {
  const useMockConditionalRecall =
    process.env.LIGHTNING_SNAPSHOT_MODE?.trim().toLowerCase() === "mock";
  const conditionalRecallSessionManager =
    options.conditionalRecallSessionManager ||
    (useMockConditionalRecall
      ? createMockConditionalRecallSessionManager()
      : createConditionalRecallSessionManager());

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, API_HEADERS);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", "http://localhost");
      const crRoute = matchConditionalRecallSessionPath(url.pathname);

      if (req.method === "GET" && crRoute) {
        if (crRoute.isResultPath) {
          conditionalRecallServerDebugLog("api result fetch", {
            sessionId: crRoute.sessionId,
          });
          const result = conditionalRecallSessionManager.getResult(crRoute.sessionId);
          if (!result) {
            const status = conditionalRecallSessionManager.getStatus(crRoute.sessionId);
            if (!status) {
              sendJson(res, 404, { ok: false, error: "Conditional Recall session not found." });
              return;
            }
            sendJson(res, 409, {
              ok: false,
              error: `Conditional Recall session is not complete yet (${status.state}).`,
              status,
            });
            return;
          }
          sendJson(res, 200, { ok: true, sessionId: crRoute.sessionId, result });
          return;
        }

        conditionalRecallServerDebugLog("api status fetch", {
          sessionId: crRoute.sessionId,
        });
        const status = conditionalRecallSessionManager.getStatus(crRoute.sessionId);
        if (!status) {
          sendJson(res, 404, { ok: false, error: "Conditional Recall session not found." });
          return;
        }
        sendJson(res, 200, { ok: true, status });
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Only GET, POST, and OPTIONS are supported." });
        return;
      }

      const body = await parseBody(req);
      const telemetry = readFrontendTelemetry(body.telemetry);
      const mode = telemetry ? "frontend_payload" : toSnapshotMode(body.mode);

      if (url.pathname === "/api/cr/config/test") {
        const routerConfig = parseConditionalRecallRouterConfig(body.routerConfig);
        conditionalRecallServerDebugLog("api config test request", {
          restHost: routerConfig.restHost,
          allowSelfSigned: routerConfig.allowSelfSigned,
        });
        const response = await conditionalRecallSessionManager.testConfig(routerConfig);
        sendJson(res, 200, response);
        return;
      }

      if (url.pathname === "/api/cr/sessions") {
        const config = parseConditionalRecallConfig(body);
        conditionalRecallServerDebugLog("api session start request", {
          restHost: config.routerConfig.restHost,
          lookbackDays: config.lookbackDays,
          liveWindowSeconds: config.liveWindowSeconds,
          channelHintCount: config.channelHints.length,
        });
        const response = await conditionalRecallSessionManager.startSession(config);
        sendJson(res, 200, response);
        return;
      }

      if (url.pathname.match(/^\/api\/cr\/sessions\/[^/]+\/cancel$/)) {
        const sessionId = decodeURIComponent(url.pathname.split("/")[4] || "");
        conditionalRecallServerDebugLog("api cancel request", { sessionId });
        const status = await conditionalRecallSessionManager.cancelSession(sessionId);
        if (!status) {
          sendJson(res, 404, { ok: false, error: "Conditional Recall session not found." });
          return;
        }
        sendJson(res, 200, { ok: true, status });
        return;
      }

      if (url.pathname === "/api/snapshot") {
        const snapshotResponse = await buildSnapshotBundle(mode, telemetry);
        sendJson(res, 200, snapshotResponse);
        return;
      }

      if (url.pathname === "/api/recommend") {
        const privacyMode = toPrivacyMode(body.privacyMode);
        const retentionMode = toRetentionMode(body.retentionMode);
        const issuedAt = typeof body.issuedAt === "string" ? body.issuedAt : undefined;
        const recommendResponse = await buildRecommendationBundle(
          mode,
          privacyMode,
          telemetry,
          issuedAt,
          retentionMode,
          options
        );
        sendJson(res, 200, recommendResponse);
        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // POST /api/recommend/channel-openings
      //
      // Receives a PROPS feature_only payload (already privacy-filtered by the
      // client's applyPrivacyPolicy step). Runs the scoring model directly on
      // the PROPS state and returns channelOpeningRecommendations.
      //
      // Expected body: { propsPayload: FeatureOnlyNodeState, privacyMode?, issuedAt? }
      // ─────────────────────────────────────────────────────────────────────
      if (url.pathname === "/api/recommend/channel-openings") {
        const propsPayload = body.propsPayload as import("../privacy/applyPrivacyPolicy").FeatureOnlyNodeState | undefined;

        if (!propsPayload || typeof propsPayload !== "object") {
          sendJson(res, 400, { ok: false, error: "Provide a propsPayload (PROPS feature_only node state)." });
          return;
        }

        const collectedAt = new Date().toISOString();
        const sourceProvenance = buildPropsProvenance(propsPayload, collectedAt);
        const recommendation = scoreNodeState(propsPayload as any, {
          nodePubkey: "props-shielded",
          nodeAlias: (propsPayload as any).nodeAlias || "my-node-alias",
          collectedAt,
        });

        const recommendationPath = path.resolve(process.cwd(), "artifacts", "channel-openings.recommendations.json");
        const sourceProvenancePath = path.resolve(process.cwd(), "artifacts", "channel-openings.source-provenance.json");
        await writeJsonDeterministic(recommendationPath, recommendation);
        await writeJsonDeterministic(sourceProvenancePath, sourceProvenance);

        sendJson(res, 200, {
          ok: true,
          route: "channel-openings",
          privacyMode: "feature_only",
          recommendationPath,
          sourceProvenancePath,
          verificationAvailable: false,
          recommendation,
          sourceProvenance,
        });
        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // POST /api/recommend/fee-suggestions
      //
      // Receives a PROPS feature_only payload scoped to a single channel
      // (already privacy-filtered by the client's applyPrivacyPolicy step).
      // Optionally includes peerFeeContext with network average fee data.
      // Runs the scoring model and returns feeRecommendations.
      //
      // Expected body: {
      //   propsPayload: FeatureOnlyNodeState,  // scoped to 1 channel
      //   peerFeeContext?: { networkInAvgPpm, networkOutAvgPpm },
      //   privacyMode?, issuedAt?
      // }
      // ─────────────────────────────────────────────────────────────────────
      if (url.pathname === "/api/recommend/fee-suggestions") {
        const propsPayload = body.propsPayload as import("../privacy/applyPrivacyPolicy").FeatureOnlyNodeState | undefined;
        const peerFeeContext = body.peerFeeContext as { networkInAvgPpm?: number | null; networkOutAvgPpm?: number | null } | undefined;

        if (!propsPayload || typeof propsPayload !== "object") {
          sendJson(res, 400, { ok: false, error: "Provide a propsPayload (PROPS feature_only node state for the channel)." });
          return;
        }

        // Merge peer fee context into the props payload as metadata so scoreNodeState
        // can use it for fee comparison, without exposing raw network data.
        const payloadWithContext = {
          ...propsPayload,
          ...(peerFeeContext ? { peerFeeContext } : {}),
        };

        const collectedAt = new Date().toISOString();
        const sourceProvenance = buildPropsProvenance(propsPayload, collectedAt);
        const recommendation = scoreNodeState(payloadWithContext as any, {
          nodePubkey: "props-shielded",
          nodeAlias: (propsPayload as any).nodeAlias || "my-node-alias",
          collectedAt,
        });

        const recommendationPath = path.resolve(process.cwd(), "artifacts", "fee-suggestions.recommendations.json");
        const sourceProvenancePath = path.resolve(process.cwd(), "artifacts", "fee-suggestions.source-provenance.json");
        await writeJsonDeterministic(recommendationPath, recommendation);
        await writeJsonDeterministic(sourceProvenancePath, sourceProvenance);

        sendJson(res, 200, {
          ok: true,
          route: "fee-suggestions",
          privacyMode: "feature_only",
          recommendationPath,
          sourceProvenancePath,
          verificationAvailable: false,
          recommendation,
          sourceProvenance,
        });
        return;
      }

      if (url.pathname === "/api/verify") {
        const arb = body.arb as ArbBundle | undefined;
        const provenance = body.sourceProvenance as SourceProvenanceReceipt | undefined;
        const devSigningKey = typeof body.devSigningKey === "string" ? body.devSigningKey.trim() : undefined;
        const now = body.now as string | number | Date | undefined;
        const inlineAttestationPolicy = parseAttestationPolicy(body.attestationPolicy);
        const sourceVerification = parseSourceVerification(body.sourceVerification);
        const inlineRequireSourceVerification = toBooleanOrUndefined(body.requireSourceVerification);
        const inlineRequireSourceVerificationOk = toBooleanOrUndefined(body.requireSourceVerificationOk);

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

        const profileDefaults = resolveVerifyPolicyProfile(body.trustPolicyProfile, loadedArb);
        const verifyResult =
          inlineAttestationPolicy ||
          sourceVerification ||
          inlineRequireSourceVerification !== undefined ||
          inlineRequireSourceVerificationOk !== undefined ||
          body.trustPolicyProfile
            ? verifyTrustedBundle({
                arb: loadedArb,
                sourceProvenance: loadedProvenance,
                devSigningKey,
                now,
                sourceVerificationResult: sourceVerification,
                attestationPolicy: inlineAttestationPolicy || profileDefaults.attestationPolicy,
                requireSourceVerification:
                  inlineRequireSourceVerification ?? profileDefaults.requireSourceVerification,
                requireSourceVerificationOk:
                  inlineRequireSourceVerificationOk ?? profileDefaults.requireSourceVerificationOk,
              })
            : verifyArb({
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
        console.log(telemetry);
        console.log(recommendation);
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
              Focus on liquidity imbalance, recent forward volume, peer fee competitiveness, and the historical successfully routed fee rate (forwardingEarningPpm).
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
