import { createHash, createHmac } from "node:crypto";
import type { SourceProvenanceReceipt } from "./provenance";
import type { RecommendationSetV1 } from "../scoring/scoreNodeState";

export interface ArbSignature {
  algorithm: "hmac-sha256";
  keyId: string;
  digest: string;
  signature: string;
}

export interface ArbBundle {
  arbVersion: "arb-v1";
  issuedAt: string;
  expiresAt: string;
  recommendationType: "fee_forward";
  sourceProvenanceHash: string;
  privacyPolicyId: string;
  modelVersion: string;
  inputHash: string;
  outputHash: string;
  recommendation: RecommendationSetV1;
  signature: ArbSignature;
}

export interface BuildArbOptions {
  recommendation: RecommendationSetV1;
  sourceProvenance: SourceProvenanceReceipt;
  privacyPolicyId: string;
  devSigningKey: string;
  issuedAt?: string;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const keyIdFromDevKey = (devSigningKey: string): string =>
  `dev-hmac-${createHash("sha256").update(devSigningKey).digest("hex").slice(0, 16)}`;

const toIso = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return date.toISOString();
};

const resolveIssuedAt = (
  recommendation: RecommendationSetV1,
  sourceProvenance: SourceProvenanceReceipt,
  issuedAtOverride?: string
): string => {
  if (issuedAtOverride) return toIso(issuedAtOverride);
  if (recommendation.collectedAt) return toIso(recommendation.collectedAt);
  return toIso(sourceProvenance.snapshotTimestamp);
};

const resolveExpiresAt = (issuedAtIso: string, ttlSeconds: number): string => {
  const issued = new Date(issuedAtIso).getTime();
  const ttlMs = ttlSeconds * 1000;
  return new Date(issued + ttlMs).toISOString();
};

export function buildArb(options: BuildArbOptions): ArbBundle {
  const ttlSeconds =
    Number.isFinite(options.ttlSeconds) && (options.ttlSeconds ?? 0) > 0
      ? Math.floor(options.ttlSeconds as number)
      : DEFAULT_TTL_SECONDS;
  const issuedAt = resolveIssuedAt(options.recommendation, options.sourceProvenance, options.issuedAt);
  const expiresAt = resolveExpiresAt(issuedAt, ttlSeconds);

  const sourceProvenanceHash = sha256Hex(options.sourceProvenance);
  const inputHash = String(options.sourceProvenance.normalizedSnapshotHash || "").trim();
  if (!inputHash) {
    throw new Error("sourceProvenance.normalizedSnapshotHash is required for ARB inputHash.");
  }
  const outputHash = sha256Hex(options.recommendation);

  const unsignedBundle = {
    arbVersion: "arb-v1" as const,
    issuedAt,
    expiresAt,
    recommendationType: "fee_forward" as const,
    sourceProvenanceHash,
    privacyPolicyId: options.privacyPolicyId,
    modelVersion: options.recommendation.modelVersion,
    inputHash,
    outputHash,
    recommendation: options.recommendation,
  };

  const digest = sha256Hex(unsignedBundle);
  const signature = createHmac("sha256", options.devSigningKey).update(digest).digest("hex");

  return {
    ...unsignedBundle,
    signature: {
      algorithm: "hmac-sha256",
      keyId: keyIdFromDevKey(options.devSigningKey),
      digest,
      signature,
    },
  };
}

