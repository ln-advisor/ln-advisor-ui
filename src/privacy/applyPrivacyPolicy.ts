import type {
  NormalizedChannelState,
  NormalizedNodeState,
  NormalizedPeerAggregate,
} from "../normalization/types";

export type PrivacyMode = "full_internal" | "feature_only" | "banded";
export type PrivacyBand = "LOW" | "MEDIUM" | "HIGH";

export interface FullInternalNodeState {
  schemaVersion: "privacy-node-state-v1";
  privacyMode: "full_internal";
  sourceSchemaVersion: "normalized-node-state-v1";
  nodeState: NormalizedNodeState;
}

export interface FeatureOnlyNodeState {
  schemaVersion: "privacy-node-state-v1";
  privacyMode: "feature_only";
  sourceSchemaVersion: "normalized-node-state-v1";
  nodeAlias: string;
  channelCount: number;
  channels: Array<{
    channelRef: string;
    peerRef: string;
    active: boolean;
    localBalanceRatio: number;
    remoteBalanceRatio: number;
    outboundFeePpm: number | null;
    inboundFeePpm: number | null;
    forwardCountIn: number;
    forwardCountOut: number;
    forwardCountTotal: number;
    revenueSat: number;
    failedForwardCount: number;
    lastActivityTimestamp: number | null;
    peerBetweennessCentrality: number | null;
    missionSuccessRate: number | null;
    missionFailureRate: number | null;
    missionLastSuccessTimestamp: number | null;
    missionLastFailTimestamp: number | null;
  }>;
  peers: Array<{
    peerRef: string;
    channelCount: number;
    activeChannelCount: number;
    avgLocalBalanceRatio: number;
    avgRemoteBalanceRatio: number;
    avgOutboundFeePpm: number | null;
    totalForwardCount: number;
    totalRevenueSat: number;
    totalFailedForwardCount: number;
    lastActivityTimestamp: number | null;
    avgPeerBetweennessCentrality: number | null;
    missionPairCount: number;
    missionSuccessRate: number | null;
    missionFailureRate: number | null;
    missionLastSuccessTimestamp: number | null;
    missionLastFailTimestamp: number | null;
  }>;
  totals: {
    forwardCount: number;
    revenueSat: number;
    failedForwardCount: number;
    avgLocalBalanceRatio: number;
    avgRemoteBalanceRatio: number;
    missionPairCount: number;
    missionPairsWithSignals: number;
    centralityPeerCount: number;
  };
}

export interface BandedNodeState {
  schemaVersion: "privacy-node-state-v1";
  privacyMode: "banded";
  sourceSchemaVersion: "normalized-node-state-v1";
  nodeAlias: string;
  channelCount: number;
  channels: Array<{
    channelRef: string;
    peerRef: string;
    active: boolean;
    liquidityBand: PrivacyBand;
    channelPerformanceBand: PrivacyBand;
    feeCompetitivenessBand: PrivacyBand;
    failedForwardPressure: "LOW" | "HIGH";
    missionReliabilityBand: PrivacyBand;
    centralityBand: PrivacyBand;
  }>;
  peers: Array<{
    peerRef: string;
    channelCount: number;
    activeChannelCount: number;
    liquidityBand: PrivacyBand;
    channelPerformanceBand: PrivacyBand;
    feeCompetitivenessBand: PrivacyBand;
    failedForwardPressure: "LOW" | "HIGH";
    missionReliabilityBand: PrivacyBand;
    centralityBand: PrivacyBand;
  }>;
  totals: {
    channelsByLiquidityBand: Record<PrivacyBand, number>;
    channelsByPerformanceBand: Record<PrivacyBand, number>;
    channelsByFeeCompetitivenessBand: Record<PrivacyBand, number>;
    channelsByMissionReliabilityBand: Record<PrivacyBand, number>;
    channelsByCentralityBand: Record<PrivacyBand, number>;
  };
}

export type PrivacyTransformedNodeState =
  | FullInternalNodeState
  | FeatureOnlyNodeState
  | BandedNodeState;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const roundFixed = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const makeRef = (prefix: "channel" | "peer", index: number): string =>
  `${prefix}_${String(index + 1).padStart(4, "0")}`;

const buildPeerRefMap = (normalized: NormalizedNodeState): Map<string, string> => {
  const peers = [...normalized.peers].sort((a, b) => compareText(a.peerPubkey, b.peerPubkey));
  const map = new Map<string, string>();
  for (let i = 0; i < peers.length; i += 1) {
    map.set(peers[i].peerPubkey, makeRef("peer", i));
  }
  return map;
};

const buildChannelRefMap = (normalized: NormalizedNodeState): Map<string, string> => {
  const channels = [...normalized.channels].sort((a, b) => compareText(a.channelId, b.channelId));
  const map = new Map<string, string>();
  for (let i = 0; i < channels.length; i += 1) {
    map.set(channels[i].channelId, makeRef("channel", i));
  }
  return map;
};

const classifyLiquidityBand = (localBalanceRatio: number): PrivacyBand => {
  if (localBalanceRatio < 0.33) return "LOW";
  if (localBalanceRatio < 0.67) return "MEDIUM";
  return "HIGH";
};

const classifyChannelPerformanceBand = (
  channel: Pick<NormalizedChannelState, "forwardCountTotal" | "revenueSat" | "failedForwardCount">
): PrivacyBand => {
  const score = channel.forwardCountTotal + Math.floor(channel.revenueSat / 100) - channel.failedForwardCount * 2;
  if (score <= 1) return "LOW";
  if (score <= 4) return "MEDIUM";
  return "HIGH";
};

const percentile = (sortedValues: number[], quantile: number): number => {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

const buildFeeBandThresholds = (channels: NormalizedChannelState[]): { p33: number; p66: number } => {
  const fees = channels
    .map((channel) => channel.outboundFeePpm)
    .filter((fee): fee is number => fee !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(fees, 1 / 3),
    p66: percentile(fees, 2 / 3),
  };
};

const classifyFeeCompetitivenessBand = (
  outboundFeePpm: number | null,
  thresholds: { p33: number; p66: number }
): PrivacyBand => {
  if (outboundFeePpm === null) return "MEDIUM";
  if (outboundFeePpm <= thresholds.p33) return "HIGH";
  if (outboundFeePpm <= thresholds.p66) return "MEDIUM";
  return "LOW";
};

const classifyFailedForwardPressure = (failedForwardCount: number): "LOW" | "HIGH" =>
  failedForwardCount > 0 ? "HIGH" : "LOW";

const buildCentralityThresholds = (channels: NormalizedChannelState[]): { p33: number; p66: number } => {
  const values = channels
    .map((channel) => channel.peerBetweennessCentrality)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(values, 1 / 3),
    p66: percentile(values, 2 / 3),
  };
};

const classifyCentralityBand = (
  centrality: number | null,
  thresholds: { p33: number; p66: number }
): PrivacyBand => {
  if (centrality === null) return "MEDIUM";
  if (centrality <= thresholds.p33) return "LOW";
  if (centrality <= thresholds.p66) return "MEDIUM";
  return "HIGH";
};

const classifyMissionReliabilityBand = (
  successRate: number | null,
  failureRate: number | null
): PrivacyBand => {
  if (successRate === null && failureRate === null) return "MEDIUM";
  const success = successRate ?? 0;
  const fail = failureRate ?? 0;
  const score = success - fail;
  if (score < -0.2) return "LOW";
  if (score < 0.2) return "MEDIUM";
  return "HIGH";
};

const toFeatureOnly = (normalized: NormalizedNodeState): FeatureOnlyNodeState => {
  const peerRefMap = buildPeerRefMap(normalized);
  const channelRefMap = buildChannelRefMap(normalized);

  const channels = [...normalized.channels]
    .sort((a, b) => compareText(a.channelId, b.channelId))
    .map((channel) => ({
      channelRef: channelRefMap.get(channel.channelId) || "channel_0000",
      peerRef: peerRefMap.get(channel.remotePubkey) || "peer_0000",
      active: channel.active,
      localBalanceRatio: channel.localBalanceRatio,
      remoteBalanceRatio: channel.remoteBalanceRatio,
      outboundFeePpm: channel.outboundFeePpm,
      inboundFeePpm: channel.inboundFeePpm,
      forwardCountIn: channel.forwardCountIn,
      forwardCountOut: channel.forwardCountOut,
      forwardCountTotal: channel.forwardCountTotal,
      revenueSat: channel.revenueSat,
      failedForwardCount: channel.failedForwardCount,
      lastActivityTimestamp: channel.lastActivityTimestamp,
      peerBetweennessCentrality: channel.peerBetweennessCentrality,
      missionSuccessRate: channel.missionSuccessRate,
      missionFailureRate: channel.missionFailureRate,
      missionLastSuccessTimestamp: channel.missionLastSuccessTimestamp,
      missionLastFailTimestamp: channel.missionLastFailTimestamp,
    }));

  const peers = [...normalized.peers]
    .sort((a, b) => compareText(a.peerPubkey, b.peerPubkey))
    .map((peer) => ({
      peerRef: peerRefMap.get(peer.peerPubkey) || "peer_0000",
      channelCount: peer.channelCount,
      activeChannelCount: peer.activeChannelCount,
      avgLocalBalanceRatio: peer.avgLocalBalanceRatio,
      avgRemoteBalanceRatio: peer.avgRemoteBalanceRatio,
      avgOutboundFeePpm: peer.avgOutboundFeePpm,
      totalForwardCount: peer.totalForwardCount,
      totalRevenueSat: peer.totalRevenueSat,
      totalFailedForwardCount: peer.totalFailedForwardCount,
      lastActivityTimestamp: peer.lastActivityTimestamp,
      avgPeerBetweennessCentrality: peer.avgPeerBetweennessCentrality,
      missionPairCount: peer.missionPairCount,
      missionSuccessRate: peer.missionSuccessRate,
      missionFailureRate: peer.missionFailureRate,
      missionLastSuccessTimestamp: peer.missionLastSuccessTimestamp,
      missionLastFailTimestamp: peer.missionLastFailTimestamp,
    }));

  const channelCount = channels.length || 1;
  const totalLocalRatio = channels.reduce((sum, channel) => sum + channel.localBalanceRatio, 0);
  const totalRemoteRatio = channels.reduce((sum, channel) => sum + channel.remoteBalanceRatio, 0);

  return {
    schemaVersion: "privacy-node-state-v1",
    privacyMode: "feature_only",
    sourceSchemaVersion: "normalized-node-state-v1",
    nodeAlias: normalized.nodeAlias,
    channelCount: normalized.channelCount,
    channels,
    peers,
    totals: {
      forwardCount: normalized.totals.forwardCount,
      revenueSat: normalized.totals.revenueSat,
      failedForwardCount: normalized.totals.failedForwardCount,
      avgLocalBalanceRatio: roundFixed(totalLocalRatio / channelCount, 6),
      avgRemoteBalanceRatio: roundFixed(totalRemoteRatio / channelCount, 6),
      missionPairCount: normalized.totals.missionPairCount,
      missionPairsWithSignals: normalized.totals.missionPairsWithSignals,
      centralityPeerCount: normalized.totals.centralityPeerCount,
    },
  };
};

const classifyPeerLiquidityBand = (peer: NormalizedPeerAggregate): PrivacyBand => {
  if (peer.avgLocalBalanceRatio < 0.33) return "LOW";
  if (peer.avgLocalBalanceRatio < 0.67) return "MEDIUM";
  return "HIGH";
};

const classifyPeerPerformanceBand = (peer: NormalizedPeerAggregate): PrivacyBand => {
  const score = peer.totalForwardCount + Math.floor(peer.totalRevenueSat / 100) - peer.totalFailedForwardCount * 2;
  if (score <= 2) return "LOW";
  if (score <= 5) return "MEDIUM";
  return "HIGH";
};

const toBanded = (normalized: NormalizedNodeState): BandedNodeState => {
  const peerRefMap = buildPeerRefMap(normalized);
  const channelRefMap = buildChannelRefMap(normalized);
  const feeThresholds = buildFeeBandThresholds(normalized.channels);
  const centralityThresholds = buildCentralityThresholds(normalized.channels);

  const channels = [...normalized.channels]
    .sort((a, b) => compareText(a.channelId, b.channelId))
    .map((channel) => ({
      channelRef: channelRefMap.get(channel.channelId) || "channel_0000",
      peerRef: peerRefMap.get(channel.remotePubkey) || "peer_0000",
      active: channel.active,
      liquidityBand: classifyLiquidityBand(channel.localBalanceRatio),
      channelPerformanceBand: classifyChannelPerformanceBand(channel),
      feeCompetitivenessBand: classifyFeeCompetitivenessBand(channel.outboundFeePpm, feeThresholds),
      failedForwardPressure: classifyFailedForwardPressure(channel.failedForwardCount),
      missionReliabilityBand: classifyMissionReliabilityBand(
        channel.missionSuccessRate,
        channel.missionFailureRate
      ),
      centralityBand: classifyCentralityBand(channel.peerBetweennessCentrality, centralityThresholds),
    }));

  const peers = [...normalized.peers]
    .sort((a, b) => compareText(a.peerPubkey, b.peerPubkey))
    .map((peer) => ({
      peerRef: peerRefMap.get(peer.peerPubkey) || "peer_0000",
      channelCount: peer.channelCount,
      activeChannelCount: peer.activeChannelCount,
      liquidityBand: classifyPeerLiquidityBand(peer),
      channelPerformanceBand: classifyPeerPerformanceBand(peer),
      feeCompetitivenessBand: classifyFeeCompetitivenessBand(peer.avgOutboundFeePpm, feeThresholds),
      failedForwardPressure: classifyFailedForwardPressure(peer.totalFailedForwardCount),
      missionReliabilityBand: classifyMissionReliabilityBand(
        peer.missionSuccessRate,
        peer.missionFailureRate
      ),
      centralityBand: classifyCentralityBand(peer.avgPeerBetweennessCentrality, centralityThresholds),
    }));

  const channelsByLiquidityBand: Record<PrivacyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const channelsByPerformanceBand: Record<PrivacyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const channelsByFeeCompetitivenessBand: Record<PrivacyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const channelsByMissionReliabilityBand: Record<PrivacyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const channelsByCentralityBand: Record<PrivacyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };

  for (const channel of channels) {
    channelsByLiquidityBand[channel.liquidityBand] += 1;
    channelsByPerformanceBand[channel.channelPerformanceBand] += 1;
    channelsByFeeCompetitivenessBand[channel.feeCompetitivenessBand] += 1;
    channelsByMissionReliabilityBand[channel.missionReliabilityBand] += 1;
    channelsByCentralityBand[channel.centralityBand] += 1;
  }

  return {
    schemaVersion: "privacy-node-state-v1",
    privacyMode: "banded",
    sourceSchemaVersion: "normalized-node-state-v1",
    nodeAlias: normalized.nodeAlias,
    channelCount: normalized.channelCount,
    channels,
    peers,
    totals: {
      channelsByLiquidityBand,
      channelsByPerformanceBand,
      channelsByFeeCompetitivenessBand,
      channelsByMissionReliabilityBand,
      channelsByCentralityBand,
    },
  };
};

export function applyPrivacyPolicy(
  normalized: NormalizedNodeState,
  mode: "full_internal"
): FullInternalNodeState;
export function applyPrivacyPolicy(
  normalized: NormalizedNodeState,
  mode: "feature_only"
): FeatureOnlyNodeState;
export function applyPrivacyPolicy(
  normalized: NormalizedNodeState,
  mode: "banded"
): BandedNodeState;
export function applyPrivacyPolicy(
  normalized: NormalizedNodeState,
  mode: PrivacyMode
): PrivacyTransformedNodeState {
  if (mode === "full_internal") {
    return {
      schemaVersion: "privacy-node-state-v1",
      privacyMode: "full_internal",
      sourceSchemaVersion: "normalized-node-state-v1",
      nodeState: normalized,
    };
  }

  if (mode === "feature_only") {
    return toFeatureOnly(normalized);
  }

  return toBanded(normalized);
}
