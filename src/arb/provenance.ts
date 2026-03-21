import { createHash } from "node:crypto";
import type { GraphSnapshotReference, LightningSnapshot, SnapshotSourceType } from "../connectors/types";
import type { NormalizedNodeState } from "../normalization/types";
import type { ArbAttestationEvidence } from "./attestation";
import type { VerifyPhalaAttestationBySourceResult } from "../tee/phala/attestationSource";
import type { PinnedModelManifest } from "../scoring/modelManifest";

export interface SourceExecutionContext {
  schemaVersion: "source-execution-context-v1";
  executionMode: "host_local" | "tee_candidate" | "tee_verified";
  enclaveProviderId: string | null;
  attestationHash: string | null;
  modelManifestHash: string | null;
  modelPinningMode: string | null;
  sourceVerificationSource: string | null;
  sourceVerificationHash: string | null;
  sourceCollectionReceiptType: string | null;
  sourceCollectionReceiptHash: string | null;
}

export interface SourceProvenanceReceipt {
  schemaVersion: "source-provenance-receipt-v1";
  sourceType: SnapshotSourceType;
  snapshotTimestamp: string;
  nodeIdentifier: string;
  rawSnapshotHash: string;
  normalizedSnapshotHash: string;
  privacyTransformedSnapshotHash: string | null;
  graphSnapshotRef: GraphSnapshotReference | null;
  executionContext: SourceExecutionContext;
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

const hashCanonicalJson = (value: unknown): string => {
  const canonical = JSON.stringify(sortObjectKeysDeep(value));
  return createHash("sha256").update(canonical).digest("hex");
};

const normalizeGraphSnapshotRef = (
  graphSnapshotRef: GraphSnapshotReference | null | undefined
): GraphSnapshotReference | null => {
  if (!graphSnapshotRef) return null;
  return {
    source: "describeGraph",
    fetchedAt: String(graphSnapshotRef.fetchedAt || ""),
    includeUnannounced: Boolean(graphSnapshotRef.includeUnannounced),
    includeAuthProof: Boolean(graphSnapshotRef.includeAuthProof),
    nodeCount: Number(graphSnapshotRef.nodeCount || 0),
    edgeCount: Number(graphSnapshotRef.edgeCount || 0),
  };
};

export function generateSourceProvenanceReceipt(
  rawSnapshot: LightningSnapshot,
  normalizedSnapshot: NormalizedNodeState,
  options?: {
    executionMode?: SourceExecutionContext["executionMode"];
    enclaveProviderId?: string | null;
    attestation?: ArbAttestationEvidence | null;
    modelManifest?: PinnedModelManifest | null;
    privacyTransformedSnapshot?: unknown;
    sourceVerificationResult?: VerifyPhalaAttestationBySourceResult | null;
  }
): SourceProvenanceReceipt {
  const snapshotTimestamp = String(rawSnapshot.collectedAt || normalizedSnapshot.collectedAt || "").trim();
  if (!snapshotTimestamp) {
    throw new Error("Missing snapshot timestamp in raw/normalized snapshot.");
  }

  const nodeIdentifier = String(
    rawSnapshot.nodeInfo?.identityPubkey || normalizedSnapshot.nodePubkey || rawSnapshot.nodeInfo?.alias || ""
  ).trim();
  if (!nodeIdentifier) {
    throw new Error("Missing node identifier in raw/normalized snapshot.");
  }

  return {
    schemaVersion: "source-provenance-receipt-v1",
    sourceType: rawSnapshot.sourceType,
    snapshotTimestamp,
    nodeIdentifier,
    rawSnapshotHash: hashCanonicalJson(rawSnapshot),
    normalizedSnapshotHash: hashCanonicalJson(normalizedSnapshot),
    privacyTransformedSnapshotHash: options?.privacyTransformedSnapshot
      ? hashCanonicalJson(options.privacyTransformedSnapshot)
      : null,
    graphSnapshotRef: normalizeGraphSnapshotRef(rawSnapshot.graphSnapshotRef),
    executionContext: {
      schemaVersion: "source-execution-context-v1",
      executionMode: options?.executionMode ?? "host_local",
      enclaveProviderId: options?.enclaveProviderId ?? null,
      attestationHash: options?.attestation ? hashCanonicalJson(options.attestation) : null,
      modelManifestHash: options?.modelManifest ? hashCanonicalJson(options.modelManifest) : null,
      modelPinningMode: options?.modelManifest?.modelPinningMode || null,
      sourceVerificationSource: options?.sourceVerificationResult?.source || null,
      sourceVerificationHash: options?.sourceVerificationResult
        ? hashCanonicalJson(options.sourceVerificationResult)
        : null,
      sourceCollectionReceiptType: null,
      sourceCollectionReceiptHash: null,
    },
  };
}
