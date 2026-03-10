import { createHash } from "node:crypto";
import type { GraphSnapshotReference, LightningSnapshot } from "../connectors/types";
import type { NormalizedNodeState } from "../normalization/types";

export interface SourceProvenanceReceipt {
  schemaVersion: "source-provenance-receipt-v1";
  sourceType: "lnc";
  snapshotTimestamp: string;
  nodeIdentifier: string;
  rawSnapshotHash: string;
  normalizedSnapshotHash: string;
  graphSnapshotRef: GraphSnapshotReference | null;
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
  normalizedSnapshot: NormalizedNodeState
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
    sourceType: "lnc",
    snapshotTimestamp,
    nodeIdentifier,
    rawSnapshotHash: hashCanonicalJson(rawSnapshot),
    normalizedSnapshotHash: hashCanonicalJson(normalizedSnapshot),
    graphSnapshotRef: normalizeGraphSnapshotRef(rawSnapshot.graphSnapshotRef),
  };
}

