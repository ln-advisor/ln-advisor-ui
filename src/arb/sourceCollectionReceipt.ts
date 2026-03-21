import { hashCanonicalJson } from "../scoring/modelManifest";
import type { SourceProvenanceReceipt } from "./provenance";

export type SourceCollectionReceiptType = "lnd_signed_collector" | "tee_attested_collector";

export interface SourceCollectionReceiptSignature {
  scheme: "lnd_signmessage_node_key";
  value: string;
}

export interface SourceCollectionReceiptAttestation {
  provider: string;
  quoteFormat: "simulated_quote" | "tdx_quote";
  quoteHash: string;
}

export interface SourceCollectionReceipt {
  schemaVersion: "source-collection-receipt-v1";
  sourceType: SourceCollectionReceiptType;
  nodePubkey: string;
  collectedAt: string;
  challengeNonce: string;
  rpcSet: string[];
  rpcSetHash: string;
  sessionScope: {
    transport: "lnc";
    macaroonScope: string;
  };
  rawSnapshotHash: string;
  normalizedSnapshotHash: string;
  privacyTransformedSnapshotHash: string;
  modelInputHash: string;
  collectorVersion: string;
  signature?: SourceCollectionReceiptSignature;
  attestation?: SourceCollectionReceiptAttestation;
}

export interface BuildSourceCollectionReceiptOptions {
  sourceType: SourceCollectionReceiptType;
  nodePubkey: string;
  collectedAt: string;
  challengeNonce: string;
  rpcSet: string[];
  collectorVersion: string;
  sessionScope?: Partial<SourceCollectionReceipt["sessionScope"]>;
  rawSnapshot?: unknown;
  rawSnapshotHash?: string;
  normalizedSnapshot?: unknown;
  normalizedSnapshotHash?: string;
  privacyTransformedSnapshot?: unknown;
  privacyTransformedSnapshotHash?: string;
  modelInputHash?: string;
  signature?: SourceCollectionReceiptSignature;
  attestation?: SourceCollectionReceiptAttestation;
}

export interface VerifySourceCollectionReceiptOptions {
  receipt: SourceCollectionReceipt;
  rawSnapshot?: unknown;
  normalizedSnapshot?: unknown;
  privacyTransformedSnapshot?: unknown;
  requireSignatureForLnd?: boolean;
  requireAttestationForTee?: boolean;
}

export interface VerifySourceCollectionReceiptResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const HEX_64_REGEX = /^[0-9a-f]{64}$/;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isHex64 = (value: unknown): boolean => isNonEmptyString(value) && HEX_64_REGEX.test(value.trim());

export const normalizeRpcSet = (rpcSet: string[]): string[] =>
  Array.from(
    new Set(
      (Array.isArray(rpcSet) ? rpcSet : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  ).sort(compareText);

export const deriveRpcSetHash = (rpcSet: string[]): string => hashCanonicalJson(normalizeRpcSet(rpcSet));

const resolveHash = (value: unknown, explicitHash?: string): string => {
  if (isNonEmptyString(explicitHash)) return explicitHash.trim();
  if (value === undefined) {
    throw new Error("A snapshot value or explicit hash is required.");
  }
  return hashCanonicalJson(value);
};

export function buildSourceCollectionReceipt(
  options: BuildSourceCollectionReceiptOptions
): SourceCollectionReceipt {
  const rpcSet = normalizeRpcSet(options.rpcSet);
  if (rpcSet.length === 0) {
    throw new Error("sourceCollectionReceipt rpcSet must include at least one RPC.");
  }

  const rawSnapshotHash = resolveHash(options.rawSnapshot, options.rawSnapshotHash);
  const normalizedSnapshotHash = resolveHash(options.normalizedSnapshot, options.normalizedSnapshotHash);
  const privacyTransformedSnapshotHash = resolveHash(
    options.privacyTransformedSnapshot,
    options.privacyTransformedSnapshotHash
  );
  const modelInputHash = String(options.modelInputHash || privacyTransformedSnapshotHash).trim();
  if (!modelInputHash) {
    throw new Error("sourceCollectionReceipt modelInputHash is required.");
  }

  return {
    schemaVersion: "source-collection-receipt-v1",
    sourceType: options.sourceType,
    nodePubkey: String(options.nodePubkey || "").trim(),
    collectedAt: String(options.collectedAt || "").trim(),
    challengeNonce: String(options.challengeNonce || "").trim(),
    rpcSet,
    rpcSetHash: deriveRpcSetHash(rpcSet),
    sessionScope: {
      transport: "lnc",
      macaroonScope: String(options.sessionScope?.macaroonScope || "read-only-collector").trim(),
    },
    rawSnapshotHash,
    normalizedSnapshotHash,
    privacyTransformedSnapshotHash,
    modelInputHash,
    collectorVersion: String(options.collectorVersion || "").trim(),
    ...(options.signature ? { signature: options.signature } : {}),
    ...(options.attestation ? { attestation: options.attestation } : {}),
  };
}

export function bindSourceCollectionReceiptToProvenance(
  provenance: SourceProvenanceReceipt,
  receipt: SourceCollectionReceipt
): SourceProvenanceReceipt {
  const receiptHash = hashCanonicalJson(receipt);
  return {
    ...provenance,
    rawSnapshotHash: receipt.rawSnapshotHash,
    normalizedSnapshotHash: receipt.normalizedSnapshotHash,
    privacyTransformedSnapshotHash: receipt.privacyTransformedSnapshotHash,
    executionContext: {
      ...provenance.executionContext,
      sourceCollectionReceiptType: receipt.sourceType,
      sourceCollectionReceiptHash: receiptHash,
    },
  };
}

export function verifySourceCollectionReceipt(
  options: VerifySourceCollectionReceiptOptions
): VerifySourceCollectionReceiptResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { receipt } = options;

  if (receipt.schemaVersion !== "source-collection-receipt-v1") {
    errors.push("Invalid sourceCollectionReceipt.schemaVersion.");
  }
  if (receipt.sourceType !== "lnd_signed_collector" && receipt.sourceType !== "tee_attested_collector") {
    errors.push("Invalid sourceCollectionReceipt.sourceType.");
  }
  if (!isNonEmptyString(receipt.nodePubkey)) {
    errors.push("sourceCollectionReceipt.nodePubkey is required.");
  }
  if (!isNonEmptyString(receipt.collectedAt) || Number.isNaN(new Date(receipt.collectedAt).getTime())) {
    errors.push("sourceCollectionReceipt.collectedAt must be a valid ISO timestamp.");
  }
  if (!isNonEmptyString(receipt.challengeNonce)) {
    errors.push("sourceCollectionReceipt.challengeNonce is required.");
  }
  if (!Array.isArray(receipt.rpcSet) || receipt.rpcSet.length === 0) {
    errors.push("sourceCollectionReceipt.rpcSet must be a non-empty array.");
  }
  if (receipt.rpcSetHash !== deriveRpcSetHash(receipt.rpcSet)) {
    errors.push("sourceCollectionReceipt.rpcSetHash does not match the canonical RPC set hash.");
  }
  if (receipt.sessionScope?.transport !== "lnc") {
    errors.push("sourceCollectionReceipt.sessionScope.transport must be 'lnc'.");
  }
  if (!isNonEmptyString(receipt.sessionScope?.macaroonScope)) {
    errors.push("sourceCollectionReceipt.sessionScope.macaroonScope is required.");
  }
  if (!isHex64(receipt.rawSnapshotHash)) {
    errors.push("sourceCollectionReceipt.rawSnapshotHash must be a 64-char lowercase hex string.");
  }
  if (!isHex64(receipt.normalizedSnapshotHash)) {
    errors.push("sourceCollectionReceipt.normalizedSnapshotHash must be a 64-char lowercase hex string.");
  }
  if (!isHex64(receipt.privacyTransformedSnapshotHash)) {
    errors.push("sourceCollectionReceipt.privacyTransformedSnapshotHash must be a 64-char lowercase hex string.");
  }
  if (!isHex64(receipt.modelInputHash)) {
    errors.push("sourceCollectionReceipt.modelInputHash must be a 64-char lowercase hex string.");
  }
  if (receipt.modelInputHash !== receipt.privacyTransformedSnapshotHash) {
    errors.push("sourceCollectionReceipt.modelInputHash must match privacyTransformedSnapshotHash in the current design.");
  }
  if (!isNonEmptyString(receipt.collectorVersion)) {
    errors.push("sourceCollectionReceipt.collectorVersion is required.");
  }

  if (receipt.sourceType === "lnd_signed_collector") {
    if (options.requireSignatureForLnd ?? false) {
      if (!receipt.signature || receipt.signature.scheme !== "lnd_signmessage_node_key" || !isNonEmptyString(receipt.signature.value)) {
        errors.push("lnd_signed_collector receipts require a valid signature.");
      }
    } else if (!receipt.signature) {
      warnings.push("lnd_signed_collector receipt is present without a signature. This is suitable only for draft integration work.");
    }
  }

  if (receipt.sourceType === "tee_attested_collector") {
    if (options.requireAttestationForTee ?? false) {
      if (
        !receipt.attestation ||
        !isNonEmptyString(receipt.attestation.provider) ||
        !["simulated_quote", "tdx_quote"].includes(receipt.attestation.quoteFormat) ||
        !isHex64(receipt.attestation.quoteHash)
      ) {
        errors.push("tee_attested_collector receipts require valid attestation metadata.");
      }
    } else if (!receipt.attestation) {
      warnings.push("tee_attested_collector receipt is present without attestation metadata. This is suitable only for draft integration work.");
    }
  }

  if (options.rawSnapshot !== undefined) {
    const recomputedRawHash = hashCanonicalJson(options.rawSnapshot);
    if (recomputedRawHash !== receipt.rawSnapshotHash) {
      errors.push("sourceCollectionReceipt.rawSnapshotHash does not match the provided raw snapshot.");
    }
  }
  if (options.normalizedSnapshot !== undefined) {
    const recomputedNormalizedHash = hashCanonicalJson(options.normalizedSnapshot);
    if (recomputedNormalizedHash !== receipt.normalizedSnapshotHash) {
      errors.push("sourceCollectionReceipt.normalizedSnapshotHash does not match the provided normalized snapshot.");
    }
  }
  if (options.privacyTransformedSnapshot !== undefined) {
    const recomputedPrivacyHash = hashCanonicalJson(options.privacyTransformedSnapshot);
    if (recomputedPrivacyHash !== receipt.privacyTransformedSnapshotHash) {
      errors.push("sourceCollectionReceipt.privacyTransformedSnapshotHash does not match the provided privacy-transformed snapshot.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
