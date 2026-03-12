import type { NormalizedNodeState } from "../normalization/types";
import {
  applyPrivacyPolicy,
  type FeatureOnlyNodeState,
  type PrivacyTransformedNodeState,
} from "../privacy/applyPrivacyPolicy";

export type FeeAction = "raise" | "lower" | "hold";
export type ActivityBand = "HOT" | "WARM" | "COLD";
export type LevelBand = "LOW" | "MEDIUM" | "HIGH";

export interface FeeRecommendationV1 {
  channelRef: string;
  peerRef: string;
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
    missionReliabilityBand: LevelBand;
    centralityBand: LevelBand;
    revenueBand: LevelBand;
    marketOutlier: "OVERPRICED" | "UNDERPRICED" | "NEUTRAL";
    peerSymmetry: "SYMMETRIC" | "ASYMMETRIC";
  };
  reasons: string[];
}

export interface ForwardOpportunityV1 {
  rank: number;
  channelRef: string;
  peerRef: string;
  score: number;
  signals: {
    forwardCount: number;
    recentActivity: ActivityBand;
    liquidityBand: LevelBand;
    channelPerformanceBand: LevelBand;
    peerPerformanceBand: LevelBand;
    missionReliabilityBand: LevelBand;
    centralityBand: LevelBand;
  };
}

export interface RecommendationSetV1 {
  schemaVersion: "recommendation-set-v1";
  modelVersion: "fee-forward-v1";
  sourceSchemaVersion: "privacy-node-state-v1";
  nodePubkey: string;
  nodeAlias: string;
  collectedAt: string;
  feeRecommendations: FeeRecommendationV1[];
  forwardOpportunityRanking: ForwardOpportunityV1[];
}

export interface ScoreNodeStateOptions {
  nodePubkey?: string;
  nodeAlias?: string;
  collectedAt?: string;
}

type ScoringInput = NormalizedNodeState | FeatureOnlyNodeState;

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

const buildFeeBandThresholds = (
  channels: FeatureOnlyNodeState["channels"]
): { p33: number; p66: number } => {
  const feeValues = channels
    .map((channel) => channel.outboundFeePpm)
    .filter((fee): fee is number => fee !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(feeValues, 1 / 3),
    p66: percentile(feeValues, 2 / 3),
  };
};

const buildCentralityThresholds = (
  channels: FeatureOnlyNodeState["channels"]
): { p33: number; p66: number } => {
  const centralityValues = channels
    .map((channel) => channel.peerBetweennessCentrality)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(centralityValues, 1 / 3),
    p66: percentile(centralityValues, 2 / 3),
  };
};

const buildRevenueThresholds = (
  channels: FeatureOnlyNodeState["channels"]
): { p33: number; p66: number } => {
  const revenueValues = channels
    .map((channel) => channel.revenueSat)
    .filter((rev): rev is number => rev !== null)
    .sort((a, b) => a - b);
  return {
    p33: percentile(revenueValues, 1 / 3),
    p66: percentile(revenueValues, 2 / 3),
  };
};

const classifyRevenueBand = (revenueSat: number, thresholds: { p33: number; p66: number }): LevelBand => {
  if (revenueSat <= thresholds.p33) return "LOW";
  if (revenueSat <= thresholds.p66) return "MEDIUM";
  return "HIGH";
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

const classifyMissionReliabilityBand = (
  successRate: number | null,
  failureRate: number | null
): LevelBand => {
  if (successRate === null && failureRate === null) return "MEDIUM";
  const success = successRate ?? 0;
  const fail = failureRate ?? 0;
  const score = success - fail;
  if (score < -0.2) return "LOW";
  if (score < 0.2) return "MEDIUM";
  return "HIGH";
};

const classifyCentralityBand = (
  centrality: number | null,
  thresholds: { p33: number; p66: number }
): LevelBand => {
  if (centrality === null) return "MEDIUM";
  if (centrality <= thresholds.p33) return "LOW";
  if (centrality <= thresholds.p66) return "MEDIUM";
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

const toFeatureInput = (
  nodeState: ScoringInput
): { featureOnly: FeatureOnlyNodeState; metadata: ScoreNodeStateOptions } => {
  const typed = nodeState as PrivacyTransformedNodeState | NormalizedNodeState;
  if ((typed as FeatureOnlyNodeState).privacyMode === "feature_only") {
    const featureOnly = typed as FeatureOnlyNodeState;
    return {
      featureOnly,
      metadata: {
        nodePubkey: "",
        nodeAlias: featureOnly.nodeAlias,
      },
    };
  }

  const normalized = typed as NormalizedNodeState;
  return {
    featureOnly: applyPrivacyPolicy(normalized, "feature_only"),
    metadata: {
      nodePubkey: normalized.nodePubkey,
      nodeAlias: normalized.nodeAlias,
      collectedAt: normalized.collectedAt,
    },
  };
};

const buildPeerMap = (
  peers: FeatureOnlyNodeState["peers"]
): Map<string, FeatureOnlyNodeState["peers"][number]> => {
  const map = new Map<string, FeatureOnlyNodeState["peers"][number]>();
  for (const peer of peers) {
    map.set(peer.peerRef, peer);
  }
  return map;
};

const buildFeeRecommendation = (
  channel: FeatureOnlyNodeState["channels"][number],
  maxActivityTs: number | null,
  feeThresholds: { p33: number; p66: number },
  centralityThresholds: { p33: number; p66: number },
  revenueThresholds: { p33: number; p66: number }
): FeeRecommendationV1 => {
  const reasons = new Set<string>();
  const recentActivity = classifyRecentActivity(channel.lastActivityTimestamp, maxActivityTs);
  const failedForwardPressure = channel.failedForwardCount > 0 ? "HIGH" : "LOW";
  const liquidityImbalance = classifyLiquidityImbalance(channel.localBalanceRatio);
  const currentFeeBand = classifyFeeBand(channel.outboundFeePpm, feeThresholds);
  const missionReliabilityBand = classifyMissionReliabilityBand(
    channel.missionSuccessRate,
    channel.missionFailureRate
  );
  const centralityBand = classifyCentralityBand(
    channel.peerBetweennessCentrality,
    centralityThresholds
  );
  const revenueBand = classifyRevenueBand(channel.revenueSat, revenueThresholds);

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
    if (liquidityImbalance === "REMOTE_HEAVY") {
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

  if (missionReliabilityBand === "LOW") {
    lowerScore += 1;
    reasons.add("mission_reliability_low");
  } else if (missionReliabilityBand === "HIGH") {
    raiseScore += 1;
    reasons.add("mission_reliability_high");
  }

  if (centralityBand === "HIGH" && currentFeeBand === "LOW") {
    raiseScore += 1;
    reasons.add("peer_centrality_high");
  }
  if (centralityBand === "LOW" && currentFeeBand === "HIGH") {
    lowerScore += 1;
    reasons.add("peer_centrality_low");
  }
  
  // Market Awareness & Peer Symmetry
  const peerInPpm = channel.inboundFeePpm ?? 0;
  const ourOutPpm = channel.outboundFeePpm ?? 0;
  let marketOutlier: "OVERPRICED" | "UNDERPRICED" | "NEUTRAL" = "NEUTRAL";
  let peerSymmetry: "SYMMETRIC" | "ASYMMETRIC" = "SYMMETRIC";

  if (ourOutPpm > peerInPpm + 500) {
    peerSymmetry = "ASYMMETRIC";
    reasons.add("peer_fee_asymmetry_high");
    raiseScore = 0; // Don't raise if already much higher than peer
    lowerScore += 1;
  }

  if (channel.networkOutAvg !== null) {
    const marketAvg = channel.networkOutAvg;
    if (ourOutPpm > marketAvg * 1.5 && ourOutPpm > 100) {
      marketOutlier = "OVERPRICED";
      reasons.add("market_price_over");
      lowerScore += 1;
    } else if (ourOutPpm < marketAvg * 0.5) {
      marketOutlier = "UNDERPRICED";
      reasons.add("market_price_under");
      raiseScore += 1;
    }
  }

  // Performance & Revenue Awareness
  if (revenueBand === "HIGH") {
    if (liquidityImbalance === "BALANCED") {
      // Protect high earning balanced channels from unnecessary fee changes
      raiseScore = 0;
      lowerScore = 0;
      reasons.add("high_yield_efficiency");
    } else if (liquidityImbalance === "REMOTE_HEAVY") {
      // Aggressively raise fees if high revenue channel is becoming scarce
      raiseScore += 2;
      reasons.add("high_yield_demand");
    }
  }

  let action: FeeAction = "hold";
  if (channel.active) {
    const scoreDelta = raiseScore - lowerScore;
    if (scoreDelta >= 2) action = "raise";
    if (scoreDelta <= -2) action = "lower";
  }

  const confidence = roundFixed(Math.min(1, Math.abs(raiseScore - lowerScore) / 5), 3);

  return {
    channelRef: channel.channelRef,
    peerRef: channel.peerRef,
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
      missionReliabilityBand,
      centralityBand,
      revenueBand,
      marketOutlier,
      peerSymmetry,
    },
    reasons: [...reasons].sort(compareText),
  };
};

const computePeerPerformanceScore = (
  peer: FeatureOnlyNodeState["peers"][number] | undefined
): number => {
  if (!peer) return 0;
  const missionBoost =
    classifyMissionReliabilityBand(peer.missionSuccessRate, peer.missionFailureRate) === "HIGH"
      ? 3
      : classifyMissionReliabilityBand(peer.missionSuccessRate, peer.missionFailureRate) === "LOW"
        ? -3
        : 0;
  const centralityBoost =
    peer.avgPeerBetweennessCentrality !== null ? Math.min(peer.avgPeerBetweennessCentrality * 20, 4) : 0;
  const score =
    Math.min(peer.totalForwardCount, 10) -
    Math.min(peer.totalFailedForwardCount * 2, 6) +
    (peer.activeChannelCount > 0 ? 2 : 0) +
    missionBoost +
    centralityBoost;
  return roundFixed(score, 3);
};

const buildForwardOpportunity = (
  channel: FeatureOnlyNodeState["channels"][number],
  maxActivityTs: number | null,
  peerMap: Map<string, FeatureOnlyNodeState["peers"][number]>,
  centralityThresholds: { p33: number; p66: number }
): Omit<ForwardOpportunityV1, "rank"> => {
  const recentActivity = classifyRecentActivity(channel.lastActivityTimestamp, maxActivityTs);
  const liquidityBand = classifyLiquidityBand(channel.localBalanceRatio);
  const missionReliabilityBand = classifyMissionReliabilityBand(
    channel.missionSuccessRate,
    channel.missionFailureRate
  );
  const centralityBand = classifyCentralityBand(
    channel.peerBetweennessCentrality,
    centralityThresholds
  );
  const peer = peerMap.get(channel.peerRef);

  const forwardVolumeScore = Math.min(channel.forwardCountTotal, 10) * 4;
  const recencyScore =
    recentActivity === "HOT" ? 25 : recentActivity === "WARM" ? 15 : channel.lastActivityTimestamp ? 5 : 0;
  const liquidityScore = roundFixed(
    Math.max(0, 20 * (1 - Math.min(Math.abs(channel.localBalanceRatio - 0.5) / 0.5, 1))),
    3
  );
  const channelPerformanceScore = roundFixed(
    Math.min(channel.revenueSat / 100, 10) +
      Math.min(channel.forwardCountTotal, 5) -
      Math.min(channel.failedForwardCount * 3, 9),
    3
  );
  const peerPerformanceScore = computePeerPerformanceScore(peer);
  const missionScore =
    missionReliabilityBand === "HIGH" ? 10 : missionReliabilityBand === "MEDIUM" ? 5 : 0;
  const centralityScore = centralityBand === "HIGH" ? 8 : centralityBand === "MEDIUM" ? 4 : 1;
  const activeBonus = channel.active ? 5 : 0;

  const totalScore = roundFixed(
    forwardVolumeScore +
      recencyScore +
      liquidityScore +
      channelPerformanceScore +
      peerPerformanceScore +
      missionScore +
      centralityScore +
      activeBonus,
    3
  );

  return {
    channelRef: channel.channelRef,
    peerRef: channel.peerRef,
    score: totalScore,
    signals: {
      forwardCount: channel.forwardCountTotal,
      recentActivity,
      liquidityBand,
      channelPerformanceBand: classifyPerformanceBand(channelPerformanceScore),
      peerPerformanceBand: classifyPerformanceBand(peerPerformanceScore),
      missionReliabilityBand,
      centralityBand,
    },
  };
};

export function scoreNodeState(
  nodeState: ScoringInput,
  options?: ScoreNodeStateOptions
): RecommendationSetV1 {
  const { featureOnly, metadata } = toFeatureInput(nodeState);
  const sortedChannels = [...featureOnly.channels].sort((a, b) => compareText(a.channelRef, b.channelRef));
  const maxActivityTs =
    sortedChannels.reduce<number | null>((maxTs, channel) => {
      if (channel.lastActivityTimestamp === null) return maxTs;
      if (maxTs === null) return channel.lastActivityTimestamp;
      return channel.lastActivityTimestamp > maxTs ? channel.lastActivityTimestamp : maxTs;
    }, null) ?? null;
  const feeThresholds = buildFeeBandThresholds(sortedChannels);
  const centralityThresholds = buildCentralityThresholds(sortedChannels);
  const revenueThresholds = buildRevenueThresholds(sortedChannels);
  const peerMap = buildPeerMap(featureOnly.peers);

  const feeRecommendations = sortedChannels
    .map((channel) =>
      buildFeeRecommendation(channel, maxActivityTs, feeThresholds, centralityThresholds, revenueThresholds)
    )
    .sort((a, b) => compareText(a.channelRef, b.channelRef));

  const ranked = sortedChannels
    .map((channel) => buildForwardOpportunity(channel, maxActivityTs, peerMap, centralityThresholds))
    .sort((a, b) => {
      if (a.score > b.score) return -1;
      if (a.score < b.score) return 1;
      return compareText(a.channelRef, b.channelRef);
    });

  const forwardOpportunityRanking: ForwardOpportunityV1[] = ranked.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));

  return {
    schemaVersion: "recommendation-set-v1",
    modelVersion: "fee-forward-v1",
    sourceSchemaVersion: "privacy-node-state-v1",
    nodePubkey: String(options?.nodePubkey ?? metadata.nodePubkey ?? ""),
    nodeAlias: String(options?.nodeAlias ?? metadata.nodeAlias ?? featureOnly.nodeAlias ?? ""),
    collectedAt: String(options?.collectedAt ?? metadata.collectedAt ?? ""),
    feeRecommendations,
    forwardOpportunityRanking,
  };
}
