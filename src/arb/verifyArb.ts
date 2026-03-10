import { createHash, createHmac } from "node:crypto";
import type { ArbBundle } from "./buildArb";
import type { SourceProvenanceReceipt } from "./provenance";

const DEFAULT_DEV_SIGNING_KEY = "arb-dev-signing-key-insecure";
const HEX_64_REGEX = /^[0-9a-f]{64}$/;

export interface VerifyArbOptions {
  arb: ArbBundle;
  devSigningKey?: string;
  now?: string | number | Date;
  sourceProvenance?: SourceProvenanceReceipt;
}

export interface VerifyArbResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

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

const expectedKeyId = (devSigningKey: string): string =>
  `dev-hmac-${createHash("sha256").update(devSigningKey).digest("hex").slice(0, 16)}`;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isHex64 = (value: unknown): boolean => isNonEmptyString(value) && HEX_64_REGEX.test(value.trim());

const parseDateMillis = (value: string): number => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const validateRequiredFields = (arb: ArbBundle, errors: string[]): void => {
  if (arb.arbVersion !== "arb-v1") errors.push("Invalid arbVersion. Expected 'arb-v1'.");
  if (!isNonEmptyString(arb.recommendationType)) errors.push("Missing recommendationType.");
  if (!isNonEmptyString(arb.privacyPolicyId)) errors.push("Missing privacyPolicyId.");
  if (!isNonEmptyString(arb.modelVersion)) errors.push("Missing modelVersion.");
  if (!arb.recommendation || typeof arb.recommendation !== "object") errors.push("Missing recommendation payload.");
  if (!arb.signature || typeof arb.signature !== "object") errors.push("Missing signature object.");

  if (!isHex64(arb.sourceProvenanceHash)) errors.push("sourceProvenanceHash must be a 64-char lowercase hex string.");
  if (!isHex64(arb.inputHash)) errors.push("inputHash must be a 64-char lowercase hex string.");
  if (!isHex64(arb.outputHash)) errors.push("outputHash must be a 64-char lowercase hex string.");

  if (arb.signature?.algorithm !== "hmac-sha256") errors.push("Unsupported signature algorithm.");
  if (!isHex64(arb.signature?.digest)) errors.push("signature.digest must be a 64-char lowercase hex string.");
  if (!isHex64(arb.signature?.signature)) errors.push("signature.signature must be a 64-char lowercase hex string.");
  if (!isNonEmptyString(arb.signature?.keyId)) errors.push("signature.keyId is required.");

  if (!isNonEmptyString(arb.issuedAt)) errors.push("issuedAt is required.");
  if (!isNonEmptyString(arb.expiresAt)) errors.push("expiresAt is required.");
};

const validateRecommendationFields = (arb: ArbBundle, errors: string[]): void => {
  const recommendation = arb.recommendation as Record<string, unknown>;
  if (recommendation?.schemaVersion !== "recommendation-set-v1") {
    errors.push("Invalid recommendation.schemaVersion. Expected 'recommendation-set-v1'.");
  }

  const recommendationModelVersion = recommendation?.modelVersion;
  if (!isNonEmptyString(recommendationModelVersion)) {
    errors.push("recommendation.modelVersion is required.");
  } else if (arb.modelVersion !== recommendationModelVersion) {
    errors.push("modelVersion mismatch between ARB and recommendation payload.");
  }

  if (!Array.isArray(recommendation?.feeRecommendations)) {
    errors.push("recommendation.feeRecommendations must be an array.");
  }
  if (!Array.isArray(recommendation?.forwardOpportunityRanking)) {
    errors.push("recommendation.forwardOpportunityRanking must be an array.");
  }
};

const validateTimeWindow = (arb: ArbBundle, nowMs: number, errors: string[]): void => {
  const issuedMs = parseDateMillis(arb.issuedAt);
  const expiresMs = parseDateMillis(arb.expiresAt);

  if (!Number.isFinite(issuedMs)) errors.push("issuedAt must be a valid ISO timestamp.");
  if (!Number.isFinite(expiresMs)) errors.push("expiresAt must be a valid ISO timestamp.");
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) return;

  if (issuedMs > expiresMs) errors.push("Invalid time window: issuedAt is after expiresAt.");
  if (nowMs > expiresMs) errors.push("ARB is expired.");
};

const validateHashConsistency = (
  arb: ArbBundle,
  sourceProvenance: SourceProvenanceReceipt | undefined,
  errors: string[]
): void => {
  const recomputedOutputHash = sha256Hex(arb.recommendation);
  if (recomputedOutputHash !== arb.outputHash) {
    errors.push("outputHash mismatch: recommendation payload hash does not match.");
  }

  const unsignedBundle = {
    arbVersion: arb.arbVersion,
    issuedAt: arb.issuedAt,
    expiresAt: arb.expiresAt,
    recommendationType: arb.recommendationType,
    sourceProvenanceHash: arb.sourceProvenanceHash,
    privacyPolicyId: arb.privacyPolicyId,
    modelVersion: arb.modelVersion,
    inputHash: arb.inputHash,
    outputHash: arb.outputHash,
    recommendation: arb.recommendation,
  };
  const recomputedDigest = sha256Hex(unsignedBundle);
  if (recomputedDigest !== arb.signature.digest) {
    errors.push("signature.digest mismatch: unsigned ARB digest does not match.");
  }

  if (sourceProvenance) {
    const provenanceHash = sha256Hex(sourceProvenance);
    if (provenanceHash !== arb.sourceProvenanceHash) {
      errors.push("sourceProvenanceHash mismatch against provided provenance receipt.");
    }
    if (sourceProvenance.normalizedSnapshotHash !== arb.inputHash) {
      errors.push("inputHash mismatch against provided provenance.normalizedSnapshotHash.");
    }
  }
};

const validateSignature = (arb: ArbBundle, devSigningKey: string, errors: string[], warnings: string[]): void => {
  if (devSigningKey === DEFAULT_DEV_SIGNING_KEY) {
    warnings.push("Using default insecure dev signing key for verification.");
  }

  const expected = createHmac("sha256", devSigningKey).update(arb.signature.digest).digest("hex");
  if (expected !== arb.signature.signature) {
    errors.push("Signature verification failed.");
  }

  const expectedId = expectedKeyId(devSigningKey);
  if (arb.signature.keyId !== expectedId) {
    errors.push("signature.keyId does not match the provided verification key.");
  }
};

export function verifyArb(options: VerifyArbOptions): VerifyArbResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const devSigningKey = (options.devSigningKey || DEFAULT_DEV_SIGNING_KEY).trim();
  if (!devSigningKey) {
    errors.push("devSigningKey is required.");
    return { ok: false, errors, warnings };
  }

  const nowMs = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
  if (!Number.isFinite(nowMs)) {
    errors.push("Invalid verification time supplied via options.now.");
    return { ok: false, errors, warnings };
  }

  validateRequiredFields(options.arb, errors);
  validateRecommendationFields(options.arb, errors);
  validateTimeWindow(options.arb, nowMs, errors);
  validateHashConsistency(options.arb, options.sourceProvenance, errors);
  validateSignature(options.arb, devSigningKey, errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

