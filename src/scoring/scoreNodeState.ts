import type { NormalizedChannelState, NormalizedNodeState, NormalizedPeerAggregate } from "../normalization/types";

export type FeeAction = "raise" | "lower" | "hold";
export type ActivityBand = "HOT" | "WARM" | "COLD";
export type LevelBand = "LOW" | "MEDIUM" | "HIGH";

export interface FeeRecommendationV1 {
  channelId: string;
  action: FeeAction;
  currentFeePpm: number | null;
  suggestedFeePpm: number | null;
  confidence: number;
  signals: {
    recentActivity: ActivityBand;
    failedForwardPressure: "LOW" | "HIGH";
    liquidityImbalance: "LOCAL_HEAVY" | "BALANCED" | "REMOTE_HEAVY";
    currentFeeBand: LevelBand | "UNKNOWN";
    forwardCount: number;
  };
  reasons: string[];
}

export interface ForwardOpportunityV1 {
  rank: number;
  channelId: string;
  score: number;
  signals: {
    forwardCount: number;
    recentActivity: ActivityBand;
    liquidityBand: LevelBand;
    channelPerformanceBand: LevelBand;
    peerPerformanceBand: LevelBand;
  };
}

export interface RecommendationSetV1 {
  schemaVersion: "recommendation-set-v1";
  modelVersion: "fee-forward-v1";
  sourceSchemaVersion: "normalized-node-state-v1";
  nodePubkey: string;
  nodeAlias: string;
  collectedAt: string;
  feeRecommendations: FeeRecommendationV1[];
  forwardOpportunityRanking: ForwardOpportunityV1[];
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const roundFixed = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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
  const feeValues = channels
    .map((channel) => channel.outboundFeePpm)
    .filter((fee): fee is number => fee !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(feeValues, 1 / 3),
    p66: percentile(feeValues, 2 / 3),
  };
};

const classifyFeeBand = (feePpm: number | null, thresholds: { p33: number; p66: number }): LevelBand | "UNKNOWN" => {
  if (feePpm === null) return "UNKNOWN";
  if (feePpm <= thresholds.p33) return "LOW";
  if (feePpm <= thresholds.p66) return "MEDIUM";
  return "HIGH";
};

const classifyRecentActivity = (lastTs: number | null, maxTs: number | null): ActivityBand => {
  if (lastTs === null || maxTs === null) return "COLD";
  const delta = Math.max(0, maxTs - lastTs);
  if (delta <= 60 * 60) return "HOT";
  if (delta <= 6 * 60 * 60) return "WARM";
  return "COLD";
};

const classifyLiquidityImbalance = (
  localBalanceRatio: number
): "LOCAL_HEAVY" | "BALANCED" | "REMOTE_HEAVY" => {
  if (localBalanceRatio > 0.65) return "LOCAL_HEAVY";
  if (localBalanceRatio < 0.35) return "REMOTE_HEAVY";
  return "BALANCED";
};

const classifyLiquidityBand = (localBalanceRatio: number): LevelBand => {
  if (localBalanceRatio < 0.33) return "LOW";
  if (localBalanceRatio < 0.67) return "MEDIUM";
  return "HIGH";
};

const classifyPerformanceBand = (score: number): LevelBand => {
  if (score <= 8) return "LOW";
  if (score <= 18) return "MEDIUM";
  return "HIGH";
};

const suggestFeePpm = (currentFeePpm: number | null, action: FeeAction): number | null => {
  if (currentFeePpm === null) return null;
  const base = Math.max(1, Math.round(currentFeePpm));
  const step = Math.max(10, Math.round(base * 0.1));
  if (action === "raise") return base + step;
  if (action === "lower") return Math.max(1, base - step);
  return base;
};

const buildPeerMap = (peers: NormalizedPeerAggregate[]): Map<string, NormalizedPeerAggregate> => {
  const map = new Map<string, NormalizedPeerAggregate>();
  for (const peer of peers) {
    map.set(peer.peerPubkey, peer);
  }
  return map;
};

const buildFeeRecommendation = (
  channel: NormalizedChannelState,
  maxActivityTs: number | null,
  feeThresholds: { p33: number; p66: number }
): FeeRecommendationV1 => {
  const reasons = new Set<string>();
  const recentActivity = classifyRecentActivity(channel.lastActivityTimestamp, maxActivityTs);
  const failedForwardPressure = channel.failedForwardCount > 0 ? "HIGH" : "LOW";
  const liquidityImbalance = classifyLiquidityImbalance(channel.localBalanceRatio);
  const currentFeeBand = classifyFeeBand(channel.outboundFeePpm, feeThresholds);

  let raiseScore = 0;
  let lowerScore = 0;

  if (!channel.active) {
    reasons.add("channel_inactive");
  }

  if (recentActivity === "HOT") {
    raiseScore += 1;
    reasons.add("recent_forward_activity");
  } else if (recentActivity === "COLD" && channel.forwardCountTotal === 0) {
    lowerScore += 1;
    reasons.add("stale_forward_activity");
  }

  if (failedForwardPressure === "HIGH") {
    reasons.add("failed_forward_pressure");
    if (channel.localBalanceRatio < 0.5) {
      raiseScore += 1;
    } else {
      lowerScore += 1;
    }
  }

  if (liquidityImbalance === "REMOTE_HEAVY") {
    raiseScore += 2;
    reasons.add("outbound_liquidity_scarce");
  } else if (liquidityImbalance === "LOCAL_HEAVY") {
    lowerScore += 2;
    reasons.add("outbound_liquidity_excess");
  }

  if (currentFeeBand === "LOW" && channel.forwardCountTotal > 0) {
    raiseScore += 1;
    reasons.add("current_fee_band_low");
  }
  if (currentFeeBand === "HIGH" && (recentActivity === "COLD" || channel.forwardCountTotal === 0)) {
    lowerScore += 1;
    reasons.add("current_fee_band_high");
  }

  let action: FeeAction = "hold";
  if (channel.active) {
    const scoreDelta = raiseScore - lowerScore;
    if (scoreDelta >= 2) action = "raise";
    if (scoreDelta <= -2) action = "lower";
  }

  const confidence = roundFixed(Math.min(1, Math.abs(raiseScore - lowerScore) / 4), 3);

  return {
    channelId: channel.channelId,
    action,
    currentFeePpm: channel.outboundFeePpm,
    suggestedFeePpm: suggestFeePpm(channel.outboundFeePpm, action),
    confidence,
    signals: {
      recentActivity,
      failedForwardPressure,
      liquidityImbalance,
      currentFeeBand,
      forwardCount: channel.forwardCountTotal,
    },
    reasons: [...reasons].sort(compareText),
  };
};

const computePeerPerformanceScore = (peer: NormalizedPeerAggregate | undefined): number => {
  if (!peer) return 0;
  const score =
    Math.min(peer.totalForwardCount, 10) - Math.min(peer.totalFailedForwardCount * 2, 6) + (peer.activeChannelCount > 0 ? 2 : 0);
  return roundFixed(score, 3);
};

const buildForwardOpportunity = (
  channel: NormalizedChannelState,
  maxActivityTs: number | null,
  peerMap: Map<string, NormalizedPeerAggregate>
): Omit<ForwardOpportunityV1, "rank"> => {
  const recentActivity = classifyRecentActivity(channel.lastActivityTimestamp, maxActivityTs);
  const liquidityBand = classifyLiquidityBand(channel.localBalanceRatio);
  const peer = peerMap.get(channel.remotePubkey);

  const forwardVolumeScore = Math.min(channel.forwardCountTotal, 10) * 4;
  const recencyScore = recentActivity === "HOT" ? 25 : recentActivity === "WARM" ? 15 : channel.lastActivityTimestamp ? 5 : 0;
  const liquidityScore = roundFixed(Math.max(0, 20 * (1 - Math.min(Math.abs(channel.localBalanceRatio - 0.5) / 0.5, 1))), 3);
  const channelPerformanceScore = roundFixed(
    Math.min(channel.revenueSat / 100, 10) + Math.min(channel.forwardCountTotal, 5) - Math.min(channel.failedForwardCount * 3, 9),
    3
  );
  const peerPerformanceScore = computePeerPerformanceScore(peer);
  const activeBonus = channel.active ? 5 : 0;

  const totalScore = roundFixed(
    forwardVolumeScore + recencyScore + liquidityScore + channelPerformanceScore + peerPerformanceScore + activeBonus,
    3
  );

  return {
    channelId: channel.channelId,
    score: totalScore,
    signals: {
      forwardCount: channel.forwardCountTotal,
      recentActivity,
      liquidityBand,
      channelPerformanceBand: classifyPerformanceBand(channelPerformanceScore),
      peerPerformanceBand: classifyPerformanceBand(peerPerformanceScore),
    },
  };
};

export function scoreNodeState(normalized: NormalizedNodeState): RecommendationSetV1 {
  const sortedChannels = [...normalized.channels].sort((a, b) => compareText(a.channelId, b.channelId));
  const maxActivityTs =
    sortedChannels.reduce<number | null>((maxTs, channel) => {
      if (channel.lastActivityTimestamp === null) return maxTs;
      if (maxTs === null) return channel.lastActivityTimestamp;
      return channel.lastActivityTimestamp > maxTs ? channel.lastActivityTimestamp : maxTs;
    }, null) ?? null;
  const feeThresholds = buildFeeBandThresholds(sortedChannels);
  const peerMap = buildPeerMap(normalized.peers);

  const feeRecommendations = sortedChannels
    .map((channel) => buildFeeRecommendation(channel, maxActivityTs, feeThresholds))
    .sort((a, b) => compareText(a.channelId, b.channelId));

  const ranked = sortedChannels
    .map((channel) => buildForwardOpportunity(channel, maxActivityTs, peerMap))
    .sort((a, b) => {
      if (a.score > b.score) return -1;
      if (a.score < b.score) return 1;
      return compareText(a.channelId, b.channelId);
    });

  const forwardOpportunityRanking: ForwardOpportunityV1[] = ranked.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));

  return {
    schemaVersion: "recommendation-set-v1",
    modelVersion: "fee-forward-v1",
    sourceSchemaVersion: "normalized-node-state-v1",
    nodePubkey: normalized.nodePubkey,
    nodeAlias: normalized.nodeAlias,
    collectedAt: normalized.collectedAt,
    feeRecommendations,
    forwardOpportunityRanking,
  };
}

