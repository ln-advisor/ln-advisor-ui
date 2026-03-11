import { Buffer } from "node:buffer";
import type {
  FrontendTelemetryEnvelope,
  GraphSnapshotReference,
  LightningChannel,
  LightningFeePolicy,
  LightningForwardingEvent,
  LightningMissionControlPair,
  LightningNodeCentralityMetric,
  LightningNodeInfo,
  LightningPeer,
  LightningRoutingFailure,
  LightningSnapshot,
  NumericLike,
} from "./types";

type JsonObject = Record<string, unknown>;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const toRecord = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object") return {};
  return value as JsonObject;
};

const pick = <T = unknown>(record: JsonObject, ...keys: string[]): T | undefined => {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key] as T;
  }
  return undefined;
};

const readString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const readNumberLike = (value: unknown): NumericLike | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
};

const readBool = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  return undefined;
};

const readChannelId = (record: JsonObject): string =>
  readString(pick(record, "chanId", "chan_id", "channelId", "channel_id"));

const bytesLikeToHex = (value: unknown): string => {
  try {
    if (!value) return "";
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized.length > 0 && /^[0-9a-f]+$/.test(normalized)) return normalized;
      return Buffer.from(value, "base64").toString("hex");
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString("hex");
    }
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return Buffer.from(Uint8Array.from(value)).toString("hex");
    }
    const record = toRecord(value);
    if (
      record.type === "Buffer" &&
      Array.isArray(record.data) &&
      (record.data as unknown[]).every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)
    ) {
      return Buffer.from(Uint8Array.from(record.data as number[])).toString("hex");
    }
  } catch {
    return "";
  }
  return "";
};

const normalizeNodeInfo = (value: unknown): LightningNodeInfo => {
  const raw = toRecord(value);
  return {
    ...raw,
    identityPubkey: readString(pick(raw, "identityPubkey", "identity_pubkey")) || bytesLikeToHex(pick(raw, "identity_pubkey")),
    alias: readString(pick(raw, "alias")),
    numActiveChannels: readNumberLike(pick(raw, "numActiveChannels", "num_active_channels")),
    numPeers: readNumberLike(pick(raw, "numPeers", "num_peers")),
    blockHeight: readNumberLike(pick(raw, "blockHeight", "block_height")),
    syncedToChain: readBool(pick(raw, "syncedToChain", "synced_to_chain")),
    syncedToGraph: readBool(pick(raw, "syncedToGraph", "synced_to_graph")),
    testnet: readBool(pick(raw, "testnet")),
    chains: Array.isArray(pick(raw, "chains")) ? (pick(raw, "chains") as unknown[]) : undefined,
    uris: Array.isArray(pick(raw, "uris")) ? (pick(raw, "uris") as string[]) : undefined,
  };
};

const normalizeChannel = (value: unknown): LightningChannel => {
  const raw = toRecord(value);
  return {
    ...raw,
    chanId: readChannelId(raw),
    channelPoint: readString(pick(raw, "channelPoint", "channel_point")),
    remotePubkey:
      readString(pick(raw, "remotePubkey", "remote_pubkey", "remotePubKey", "remote_pub_key")) ||
      bytesLikeToHex(pick(raw, "remote_pubkey", "remotePubkey", "remotePubKey")),
    active: pick(raw, "active") !== undefined ? Boolean(pick(raw, "active")) : undefined,
    capacity: readNumberLike(pick(raw, "capacity")),
    localBalance: readNumberLike(pick(raw, "localBalance", "local_balance")),
    remoteBalance: readNumberLike(pick(raw, "remoteBalance", "remote_balance")),
    totalSatoshisSent: readNumberLike(pick(raw, "totalSatoshisSent", "total_satoshis_sent")),
    totalSatoshisReceived: readNumberLike(pick(raw, "totalSatoshisReceived", "total_satoshis_received")),
    numUpdates: readNumberLike(pick(raw, "numUpdates", "num_updates")),
  };
};

const normalizeForwardingEvent = (value: unknown): LightningForwardingEvent => {
  const raw = toRecord(value);
  return {
    ...raw,
    timestamp: readNumberLike(pick(raw, "timestamp")),
    timestampNs: readNumberLike(pick(raw, "timestampNs", "timestamp_ns")),
    chanIdIn: readString(pick(raw, "chanIdIn", "chan_id_in")),
    chanIdOut: readString(pick(raw, "chanIdOut", "chan_id_out")),
    amtIn: readNumberLike(pick(raw, "amtIn", "amt_in", "amtInSat", "amt_in_sat")),
    amtOut: readNumberLike(pick(raw, "amtOut", "amt_out", "amtOutSat", "amt_out_sat")),
    fee: readNumberLike(pick(raw, "fee", "feeSat", "fee_sat")),
  };
};

const normalizeRoutingFailure = (value: unknown): LightningRoutingFailure => {
  const raw = toRecord(value);
  return {
    ...raw,
    timestamp: readNumberLike(pick(raw, "timestamp")),
    incomingChannelId: readString(pick(raw, "incomingChannelId", "incoming_channel_id", "incomingChannel", "incoming_channel")),
    outgoingChannelId: readString(pick(raw, "outgoingChannelId", "outgoing_channel_id", "outgoingChannel", "outgoing_channel")),
    failureCode: readString(pick(raw, "failureCode", "failure_code", "code")),
    failureDetail: readString(pick(raw, "failureDetail", "failure_detail", "detail")),
  };
};

const normalizePeer = (value: unknown): LightningPeer => {
  const raw = toRecord(value);
  return {
    ...raw,
    pubKey: readString(pick(raw, "pubKey", "pub_key", "pubkey")) || bytesLikeToHex(pick(raw, "pub_key", "pubKey")),
    address: readString(pick(raw, "address")),
    bytesSent: readNumberLike(pick(raw, "bytesSent", "bytes_sent")),
    bytesRecv: readNumberLike(pick(raw, "bytesRecv", "bytes_recv")),
    satSent: readNumberLike(pick(raw, "satSent", "sat_sent")),
    satRecv: readNumberLike(pick(raw, "satRecv", "sat_recv")),
    inbound: pick(raw, "inbound") !== undefined ? Boolean(pick(raw, "inbound")) : undefined,
    pingTime: readNumberLike(pick(raw, "pingTime", "ping_time")),
  };
};

const normalizeFeePolicy = (value: unknown): LightningFeePolicy | null => {
  const raw = toRecord(value);
  const channelId = readString(pick(raw, "channelId", "channel_id"));
  const directionPubKey =
    readString(pick(raw, "directionPubKey", "direction_pub_key", "pubKey", "pub_key")) ||
    bytesLikeToHex(pick(raw, "direction_pub_key", "directionPubKey"));
  if (!channelId || !directionPubKey) return null;
  return {
    ...raw,
    channelId,
    directionPubKey,
    feeRatePpm: readNumberLike(pick(raw, "feeRatePpm", "fee_rate_ppm", "feeRateMilliMsat", "fee_rate_milli_msat")),
    feeBaseMsat: readNumberLike(pick(raw, "feeBaseMsat", "fee_base_msat")),
    timeLockDelta: readNumberLike(pick(raw, "timeLockDelta", "time_lock_delta")),
    minHtlcMsat: readNumberLike(pick(raw, "minHtlcMsat", "min_htlc_msat", "minHtlc", "min_htlc")),
    maxHtlcMsat: readNumberLike(pick(raw, "maxHtlcMsat", "max_htlc_msat")),
    disabled: pick(raw, "disabled") !== undefined ? Boolean(pick(raw, "disabled")) : undefined,
  };
};

const normalizeFeePolicyRecordFromGraph = (
  channelId: string,
  directionPubKey: string,
  rawPolicy: JsonObject
): LightningFeePolicy => ({
  ...rawPolicy,
  channelId,
  directionPubKey,
  feeRatePpm: readNumberLike(pick(rawPolicy, "feeRateMilliMsat", "fee_rate_milli_msat")),
  feeBaseMsat: readNumberLike(pick(rawPolicy, "feeBaseMsat", "fee_base_msat")),
  timeLockDelta: readNumberLike(pick(rawPolicy, "timeLockDelta", "time_lock_delta")),
  minHtlcMsat: readNumberLike(pick(rawPolicy, "minHtlcMsat", "min_htlc_msat", "minHtlc", "min_htlc")),
  maxHtlcMsat: readNumberLike(pick(rawPolicy, "maxHtlcMsat", "max_htlc_msat")),
  disabled: pick(rawPolicy, "disabled") !== undefined ? Boolean(pick(rawPolicy, "disabled")) : undefined,
});

const normalizeMissionControlPair = (value: unknown): LightningMissionControlPair | null => {
  const raw = toRecord(value);
  const history = toRecord(pick(raw, "history", "pairHistory"));
  const nodeFrom = bytesLikeToHex(pick(raw, "nodeFrom", "node_from")) || readString(pick(raw, "nodeFrom", "node_from"));
  const nodeTo = bytesLikeToHex(pick(raw, "nodeTo", "node_to")) || readString(pick(raw, "nodeTo", "node_to"));

  if (!nodeFrom || !nodeTo) return null;

  const successTimestamp = readNumberLike(pick(history, "successTime", "success_time"));
  const failTimestamp = readNumberLike(pick(history, "failTime", "fail_time"));
  const successCount =
    readNumberLike(pick(raw, "successCount", "success_count")) ?? (successTimestamp ? 1 : 0);
  const failCount = readNumberLike(pick(raw, "failCount", "fail_count")) ?? (failTimestamp ? 1 : 0);

  return {
    ...raw,
    nodeFrom,
    nodeTo,
    successCount,
    failCount,
    successAmtSat: readNumberLike(pick(history, "successAmtSat", "success_amt_sat")),
    failAmtSat: readNumberLike(pick(history, "failAmtSat", "fail_amt_sat")),
    lastSuccessTimestamp: successTimestamp,
    lastFailTimestamp: failTimestamp,
  };
};

const normalizeNodeCentralityMetric = (
  nodePubkey: string,
  value: unknown
): LightningNodeCentralityMetric | null => {
  const pubkey = bytesLikeToHex(nodePubkey) || String(nodePubkey || "").trim().toLowerCase();
  if (!pubkey) return null;
  const raw = toRecord(value);
  const metricValue =
    readNumberLike(pick(raw, "normalizedValue", "normalized_value", "value")) ??
    (typeof value === "number" || typeof value === "string" ? readNumberLike(value) : undefined);
  return {
    ...raw,
    nodePubkey: pubkey,
    betweennessCentrality: metricValue,
  };
};

const extractFeePoliciesFromGraph = (graphSnapshot: JsonObject): LightningFeePolicy[] => {
  const edges = Array.isArray(pick(graphSnapshot, "edges")) ? (pick(graphSnapshot, "edges") as unknown[]) : [];
  const policies: LightningFeePolicy[] = [];

  for (const edge of edges) {
    const edgeRecord = toRecord(edge);
    const channelId = readString(pick(edgeRecord, "channel_id", "channelId"));
    if (!channelId) continue;
    const node1Pub =
      readString(pick(edgeRecord, "node1_pub", "node1Pub")) || bytesLikeToHex(pick(edgeRecord, "node1_pub", "node1Pub"));
    const node2Pub =
      readString(pick(edgeRecord, "node2_pub", "node2Pub")) || bytesLikeToHex(pick(edgeRecord, "node2_pub", "node2Pub"));
    const node1Policy = toRecord(pick(edgeRecord, "node1_policy", "node1Policy"));
    const node2Policy = toRecord(pick(edgeRecord, "node2_policy", "node2Policy"));

    if (Object.keys(node1Policy).length > 0 && node1Pub) {
      policies.push(normalizeFeePolicyRecordFromGraph(channelId, node1Pub, node1Policy));
    }
    if (Object.keys(node2Policy).length > 0 && node2Pub) {
      policies.push(normalizeFeePolicyRecordFromGraph(channelId, node2Pub, node2Policy));
    }
  }

  return policies.sort((a, b) => {
    const byChannel = compareText(a.channelId, b.channelId);
    if (byChannel !== 0) return byChannel;
    return compareText(a.directionPubKey, b.directionPubKey);
  });
};

const buildGraphSnapshotRef = (
  graphSnapshot: JsonObject | null,
  fallbackCollectedAt: string
): GraphSnapshotReference | null => {
  if (!graphSnapshot) return null;
  const nodes = Array.isArray(pick(graphSnapshot, "nodes")) ? (pick(graphSnapshot, "nodes") as unknown[]) : [];
  const edges = Array.isArray(pick(graphSnapshot, "edges")) ? (pick(graphSnapshot, "edges") as unknown[]) : [];
  return {
    source: "describeGraph",
    fetchedAt: readString(pick(graphSnapshot, "fetchedAt", "fetched_at")) || fallbackCollectedAt,
    includeUnannounced: Boolean(pick(graphSnapshot, "includeUnannounced", "include_unannounced")),
    includeAuthProof: Boolean(pick(graphSnapshot, "includeAuthProof", "include_auth_proof")),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
};

export function telemetryToLightningSnapshot(
  telemetry: FrontendTelemetryEnvelope
): LightningSnapshot {
  const collectedAt = String(telemetry.collectedAt || "").trim();
  if (!collectedAt) {
    throw new Error("frontend telemetry missing collectedAt.");
  }

  const namespace = String(telemetry.namespace || "").trim() || "tapvolt";
  const nodeInfo = telemetry.nodeInfo ? normalizeNodeInfo(telemetry.nodeInfo) : null;

  const channels = [...(Array.isArray(telemetry.channels) ? telemetry.channels : [])]
    .map(normalizeChannel)
    .sort((a, b) => compareText(a.chanId || "", b.chanId || ""));

  const forwardingHistory = [...(Array.isArray(telemetry.forwardingHistory) ? telemetry.forwardingHistory : [])]
    .map(normalizeForwardingEvent)
    .sort((a, b) => {
      const aTs = String(a.timestampNs ?? a.timestamp ?? "");
      const bTs = String(b.timestampNs ?? b.timestamp ?? "");
      const byTs = compareText(aTs, bTs);
      if (byTs !== 0) return byTs;
      const byIn = compareText(a.chanIdIn || "", b.chanIdIn || "");
      if (byIn !== 0) return byIn;
      return compareText(a.chanIdOut || "", b.chanIdOut || "");
    });

  const routingFailures = [...(Array.isArray(telemetry.routingFailures) ? telemetry.routingFailures : [])]
    .map(normalizeRoutingFailure)
    .sort((a, b) => {
      const byTs = compareText(String(a.timestamp ?? ""), String(b.timestamp ?? ""));
      if (byTs !== 0) return byTs;
      const byIn = compareText(a.incomingChannelId || "", b.incomingChannelId || "");
      if (byIn !== 0) return byIn;
      return compareText(a.outgoingChannelId || "", b.outgoingChannelId || "");
    });

  const graphSnapshot = telemetry.graphSnapshot ? toRecord(telemetry.graphSnapshot) : null;
  const explicitFeePolicies = [...(Array.isArray(telemetry.feePolicies) ? telemetry.feePolicies : [])]
    .map(normalizeFeePolicy)
    .filter((item): item is LightningFeePolicy => item !== null);
  const feePolicies = (explicitFeePolicies.length > 0 ? explicitFeePolicies : extractFeePoliciesFromGraph(graphSnapshot || {}))
    .sort((a, b) => {
      const byChannel = compareText(a.channelId, b.channelId);
      if (byChannel !== 0) return byChannel;
      return compareText(a.directionPubKey, b.directionPubKey);
    });

  const missionControlPairs = [...(Array.isArray(telemetry.missionControl?.pairs) ? telemetry.missionControl?.pairs : [])]
    .map(normalizeMissionControlPair)
    .filter((item): item is LightningMissionControlPair => item !== null)
    .sort((a, b) => {
      const byFrom = compareText(a.nodeFrom || "", b.nodeFrom || "");
      if (byFrom !== 0) return byFrom;
      return compareText(a.nodeTo || "", b.nodeTo || "");
    });

  const centralitySource = toRecord(telemetry.nodeMetrics?.betweennessCentrality);
  const nodeCentralityMetrics = Object.keys(centralitySource)
    .sort(compareText)
    .map((nodePubkey) => normalizeNodeCentralityMetric(nodePubkey, centralitySource[nodePubkey]))
    .filter((item): item is LightningNodeCentralityMetric => item !== null);

  const peers = [...(Array.isArray(telemetry.peers) ? telemetry.peers : [])]
    .map(normalizePeer)
    .sort((a, b) => compareText(a.pubKey || "", b.pubKey || ""));

  return {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc_frontend_extractor",
    collectedAt,
    namespace,
    nodeInfo,
    channels,
    forwardingHistory,
    routingFailures,
    feePolicies,
    missionControlPairs,
    nodeCentralityMetrics,
    peers,
    graphSnapshotRef: buildGraphSnapshotRef(graphSnapshot, collectedAt),
  };
}

export function snapshotToFrontendTelemetry(snapshot: LightningSnapshot): FrontendTelemetryEnvelope {
  return {
    schemaVersion: "frontend-telemetry-envelope-v1",
    collectedAt: snapshot.collectedAt,
    namespace: snapshot.namespace,
    nodeInfo: snapshot.nodeInfo,
    channels: snapshot.channels,
    forwardingHistory: snapshot.forwardingHistory,
    routingFailures: snapshot.routingFailures,
    feePolicies: snapshot.feePolicies,
    peers: snapshot.peers || [],
    graphSnapshot: snapshot.graphSnapshotRef
      ? {
          fetchedAt: snapshot.graphSnapshotRef.fetchedAt,
          includeUnannounced: snapshot.graphSnapshotRef.includeUnannounced,
          includeAuthProof: snapshot.graphSnapshotRef.includeAuthProof,
          nodes: [],
          edges: [],
        }
      : null,
    missionControl: {
      pairs: snapshot.missionControlPairs || [],
    },
    nodeMetrics: {
      betweennessCentrality: Object.fromEntries(
        [...(snapshot.nodeCentralityMetrics || [])]
          .sort((a, b) => compareText(a.nodePubkey, b.nodePubkey))
          .map((row) => [
            row.nodePubkey,
            {
              normalizedValue: row.betweennessCentrality ?? 0,
            },
          ])
      ),
    },
  };
}
