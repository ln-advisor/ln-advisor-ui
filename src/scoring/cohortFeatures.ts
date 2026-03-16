import type { FeatureOnlyNodeState } from "../privacy/applyPrivacyPolicy";

export type CohortLevelBand = "LOW" | "MEDIUM" | "HIGH";
export type CohortActivityBand = "LOW" | "MEDIUM" | "HIGH";
export type CohortSizeBand = "SMALL" | "MEDIUM" | "LARGE";
export type CohortLiquidityPosture = "INBOUND_HEAVY" | "BALANCED" | "OUTBOUND_HEAVY";

export interface CohortFeaturesV1 {
  schemaVersion: "cohort-features-v1";
  sourceSchemaVersion: "privacy-node-state-v1";
  derivedFromPrivacyMode: "feature_only";
  nodeProfile: {
    channelCountBand: CohortSizeBand;
    activityBand: CohortActivityBand;
    failurePressureBand: CohortLevelBand;
    feePostureBand: CohortLevelBand;
    liquidityPosture: CohortLiquidityPosture;
  };
  channels: Array<{
    channelRef: string;
    peerRef: string;
    active: boolean;
    liquidityBand: CohortLevelBand;
    feeBand: CohortLevelBand;
    activityBand: CohortActivityBand;
    performanceBand: CohortLevelBand;
    missionReliabilityBand: CohortLevelBand;
    centralityBand: CohortLevelBand;
  }>;
  peers: Array<{
    peerRef: string;
    channelCountBand: CohortSizeBand;
    activityBand: CohortActivityBand;
    performanceBand: CohortLevelBand;
    missionReliabilityBand: CohortLevelBand;
    centralityBand: CohortLevelBand;
  }>;
}

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

const buildThresholds = (values: number[]): { p33: number; p66: number } => {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    p33: percentile(sorted, 1 / 3),
    p66: percentile(sorted, 2 / 3),
  };
};

const toLevelBand = (value: number | null, thresholds: { p33: number; p66: number }): CohortLevelBand => {
  const numeric = value ?? 0;
  if (numeric <= thresholds.p33) return "LOW";
  if (numeric <= thresholds.p66) return "MEDIUM";
  return "HIGH";
};

const toActivityBand = (value: number): CohortActivityBand => {
  if (value <= 5) return "LOW";
  if (value <= 25) return "MEDIUM";
  return "HIGH";
};

const toSizeBand = (value: number): CohortSizeBand => {
  if (value <= 3) return "SMALL";
  if (value <= 12) return "MEDIUM";
  return "LARGE";
};

const toLiquidityBand = (ratio: number): CohortLevelBand => {
  if (ratio < 0.33) return "LOW";
  if (ratio < 0.67) return "MEDIUM";
  return "HIGH";
};

const toLiquidityPosture = (avgLocalBalanceRatio: number): CohortLiquidityPosture => {
  if (avgLocalBalanceRatio < 0.4) return "INBOUND_HEAVY";
  if (avgLocalBalanceRatio > 0.6) return "OUTBOUND_HEAVY";
  return "BALANCED";
};

const toMissionReliabilityBand = (
  successRate: number | null,
  failureRate: number | null
): CohortLevelBand => {
  const score = (successRate ?? 0) - (failureRate ?? 0);
  if (score < -0.2) return "LOW";
  if (score < 0.2) return "MEDIUM";
  return "HIGH";
};

export const buildCohortFeatures = (featureOnly: FeatureOnlyNodeState): CohortFeaturesV1 => {
  const feeThresholds = buildThresholds(
    featureOnly.channels
      .map((channel) => channel.outboundFeePpm)
      .filter((value): value is number => value !== null)
  );
  const channelPerformanceThresholds = buildThresholds(
    featureOnly.channels.map((channel) => channel.forwardCountTotal + channel.revenueSat)
  );
  const channelCentralityThresholds = buildThresholds(
    featureOnly.channels
      .map((channel) => channel.peerBetweennessCentrality)
      .filter((value): value is number => value !== null)
  );
  const peerPerformanceThresholds = buildThresholds(
    featureOnly.peers.map((peer) => peer.totalForwardCount + peer.totalRevenueSat)
  );
  const peerCentralityThresholds = buildThresholds(
    featureOnly.peers
      .map((peer) => peer.avgPeerBetweennessCentrality)
      .filter((value): value is number => value !== null)
  );

  return {
    schemaVersion: "cohort-features-v1",
    sourceSchemaVersion: "privacy-node-state-v1",
    derivedFromPrivacyMode: "feature_only",
    nodeProfile: {
      channelCountBand: toSizeBand(featureOnly.channelCount),
      activityBand: toActivityBand(featureOnly.totals.forwardCount),
      failurePressureBand: toLevelBand(featureOnly.totals.failedForwardCount, { p33: 1, p66: 5 }),
      feePostureBand: toLevelBand(
        featureOnly.channels
          .map((channel) => channel.outboundFeePpm)
          .filter((value): value is number => value !== null)
          .reduce((sum, value, _, items) => sum + value / Math.max(items.length, 1), 0),
        feeThresholds
      ),
      liquidityPosture: toLiquidityPosture(featureOnly.totals.avgLocalBalanceRatio),
    },
    channels: featureOnly.channels.map((channel) => ({
      channelRef: channel.channelRef,
      peerRef: channel.peerRef,
      active: channel.active,
      liquidityBand: toLiquidityBand(channel.localBalanceRatio),
      feeBand: toLevelBand(channel.outboundFeePpm, feeThresholds),
      activityBand: toActivityBand(channel.forwardCountTotal),
      performanceBand: toLevelBand(
        channel.forwardCountTotal + channel.revenueSat,
        channelPerformanceThresholds
      ),
      missionReliabilityBand: toMissionReliabilityBand(
        channel.missionSuccessRate,
        channel.missionFailureRate
      ),
      centralityBand: toLevelBand(channel.peerBetweennessCentrality, channelCentralityThresholds),
    })),
    peers: featureOnly.peers.map((peer) => ({
      peerRef: peer.peerRef,
      channelCountBand: toSizeBand(peer.channelCount),
      activityBand: toActivityBand(peer.totalForwardCount),
      performanceBand: toLevelBand(peer.totalForwardCount + peer.totalRevenueSat, peerPerformanceThresholds),
      missionReliabilityBand: toMissionReliabilityBand(peer.missionSuccessRate, peer.missionFailureRate),
      centralityBand: toLevelBand(peer.avgPeerBetweennessCentrality, peerCentralityThresholds),
    })),
  };
};
