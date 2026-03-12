export type NumericLike = number | string;

export type SnapshotSourceType = "lnc" | "lnc_frontend_extractor";

export interface LightningNodeInfo {
  identityPubkey?: string;
  alias?: string;
  numActiveChannels?: NumericLike;
  numPeers?: NumericLike;
  blockHeight?: NumericLike;
  syncedToChain?: boolean;
  syncedToGraph?: boolean;
  testnet?: boolean;
  chains?: unknown[];
  uris?: string[];
  // TODO(step-1): Freeze additional node metadata fields once exact RPC payloads are pinned.
  [key: string]: unknown;
}

export interface LightningChannel {
  chanId?: string;
  channelPoint?: string;
  remotePubkey?: string;
  active?: boolean;
  capacity?: NumericLike;
  localBalance?: NumericLike;
  remoteBalance?: NumericLike;
  totalSatoshisSent?: NumericLike;
  totalSatoshisReceived?: NumericLike;
  numUpdates?: NumericLike;
  networkInAvg?: number;
  networkOutAvg?: number;
  [key: string]: unknown;
}

export interface LightningForwardingEvent {
  timestamp?: NumericLike;
  timestampNs?: NumericLike;
  chanIdIn?: string;
  chanIdOut?: string;
  amtIn?: NumericLike;
  amtOut?: NumericLike;
  fee?: NumericLike;
  // TODO(step-1): Confirm if event-level metadata (settle/failure context) is available in this RPC shape.
  [key: string]: unknown;
}

export interface LightningRoutingFailure {
  timestamp?: NumericLike;
  incomingChannelId?: string;
  outgoingChannelId?: string;
  failureCode?: string;
  failureDetail?: string;
  // TODO(step-1): Wire to concrete LND/LNC failure RPC once selected.
  [key: string]: unknown;
}

export interface LightningMissionControlPair {
  nodeFrom?: string;
  nodeTo?: string;
  successCount?: NumericLike;
  failCount?: NumericLike;
  successAmtSat?: NumericLike;
  failAmtSat?: NumericLike;
  lastSuccessTimestamp?: NumericLike;
  lastFailTimestamp?: NumericLike;
  // TODO(step-adjustment): Add additional mission control fields once exact router RPC shape is pinned.
  [key: string]: unknown;
}

export interface LightningNodeCentralityMetric {
  nodePubkey: string;
  betweennessCentrality?: NumericLike;
  // TODO(step-adjustment): Add more graph metric types after model versions consume them.
  [key: string]: unknown;
}

export interface LightningFeePolicy {
  channelId: string;
  directionPubKey: string;
  feeRatePpm?: NumericLike;
  feeBaseMsat?: NumericLike;
  timeLockDelta?: NumericLike;
  minHtlcMsat?: NumericLike;
  maxHtlcMsat?: NumericLike;
  disabled?: boolean;
  // TODO(step-1): Add inbound fee fields if available in your node version.
  [key: string]: unknown;
}

export interface LightningPeer {
  pubKey?: string;
  address?: string;
  bytesSent?: NumericLike;
  bytesRecv?: NumericLike;
  satSent?: NumericLike;
  satRecv?: NumericLike;
  inbound?: boolean;
  pingTime?: NumericLike;
  // TODO(step-1): Confirm durable peer identifiers for long-term aggregation.
  [key: string]: unknown;
}

export interface GraphSnapshotReference {
  source: "describeGraph";
  fetchedAt: string;
  includeUnannounced: boolean;
  includeAuthProof: boolean;
  nodeCount: number;
  edgeCount: number;
  // TODO(step-1): Add a graph digest/hash once graph snapshots are persisted separately.
  [key: string]: unknown;
}

export interface LightningSnapshot {
  schemaVersion: "lightning-snapshot-v1";
  sourceType: SnapshotSourceType;
  collectedAt: string;
  namespace: string;
  nodeInfo: LightningNodeInfo | null;
  channels: LightningChannel[];
  forwardingHistory: LightningForwardingEvent[];
  routingFailures: LightningRoutingFailure[];
  feePolicies: LightningFeePolicy[];
  missionControlPairs?: LightningMissionControlPair[];
  nodeCentralityMetrics?: LightningNodeCentralityMetric[];
  peers?: LightningPeer[];
  graphSnapshotRef: GraphSnapshotReference | null;
}

export interface FrontendGraphSnapshot {
  fetchedAt?: string;
  includeUnannounced?: boolean;
  includeAuthProof?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
  [key: string]: unknown;
}

export interface FrontendMissionControlSnapshot {
  pairs?: unknown[];
  [key: string]: unknown;
}

export interface FrontendNodeMetricsSnapshot {
  betweennessCentrality?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FrontendTelemetryEnvelope {
  schemaVersion: "frontend-telemetry-envelope-v1";
  collectedAt: string;
  namespace: string;
  nodeInfo: unknown | null;
  channels: unknown[];
  forwardingHistory: unknown[];
  routingFailures?: unknown[];
  feePolicies?: unknown[];
  peers?: unknown[];
  graphSnapshot?: FrontendGraphSnapshot | null;
  missionControl?: FrontendMissionControlSnapshot | null;
  nodeMetrics?: FrontendNodeMetricsSnapshot | null;
  metadata?: unknown;
}
