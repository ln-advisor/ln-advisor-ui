import type { ArbBundle } from "../arb/buildArb";
import { verifyArb } from "../arb/verifyArb";

export interface ExplainRequest {
  question?: string;
  includeTopRanked?: number;
}

export interface FeeRecommendationExplanation {
  channelRef: string;
  peerRef: string;
  action: "raise" | "lower" | "hold";
  explanation: string;
  confidence: number;
  evidence: {
    currentFeePpm: number | null;
    suggestedFeePpm: number | null;
    recentActivity: string;
    failedForwardPressure: string;
    liquidityImbalance: string;
    currentFeeBand: string;
    missionReliabilityBand: string;
    centralityBand: string;
    reasons: string[];
  };
}

export interface ForwardRankingExplanation {
  rank: number;
  channelRef: string;
  peerRef: string;
  explanation: string;
  score: number;
  evidence: {
    forwardCount: number;
    recentActivity: string;
    liquidityBand: string;
    channelPerformanceBand: string;
    peerPerformanceBand: string;
    missionReliabilityBand: string;
    centralityBand: string;
  };
}

export interface ExplainedRecommendations {
  schemaVersion: "recommendations-explained-v1";
  generatedAt: string;
  recommendationType: "fee_forward";
  arbReference: {
    arbVersion: string;
    modelVersion: string;
    privacyPolicyId: string;
    outputHash: string;
    signatureDigest: string;
  };
  request: {
    question: string | null;
  };
  summary: {
    totalFeeRecommendations: number;
    actionCounts: {
      raise: number;
      lower: number;
      hold: number;
    };
    topRankedChannels: string[];
  };
  feeRecommendationExplanations: FeeRecommendationExplanation[];
  forwardRankingExplanations: ForwardRankingExplanation[];
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const REASON_MAP: Record<string, string> = {
  channel_inactive: "the channel is currently inactive",
  recent_forward_activity: "recent forwarding activity is strong",
  stale_forward_activity: "forwarding activity is currently stale",
  failed_forward_pressure: "recent failed forwards indicate routing pressure",
  outbound_liquidity_scarce: "outbound liquidity appears scarce",
  outbound_liquidity_excess: "outbound liquidity appears abundant",
  mission_reliability_low: "mission-control reliability is low",
  mission_reliability_high: "mission-control reliability is high",
  peer_centrality_high: "peer centrality is high",
  peer_centrality_low: "peer centrality is low",
};

const humanizeReasons = (reasons: string[]): string[] =>
  reasons.map((reason) => REASON_MAP[reason] || reason.replaceAll("_", " "));

const actionVerb = (action: "raise" | "lower" | "hold"): string => {
  if (action === "raise") return "raise";
  if (action === "lower") return "lower";
  return "hold";
};

const buildFeeExplanation = (
  recommendation: ArbBundle["recommendation"]["feeRecommendations"][number]
): FeeRecommendationExplanation => {
  const reasons = [...(recommendation.reasons || [])].sort(compareText);
  const humanReasons = humanizeReasons(reasons);
  const feeSentence =
    recommendation.currentFeePpm !== null && recommendation.suggestedFeePpm !== null
      ? `from ${recommendation.currentFeePpm} ppm to ${recommendation.suggestedFeePpm} ppm`
      : "at its current configured value";
  const reasonsSentence =
    humanReasons.length > 0 ? humanReasons.join("; ") : "available signals do not strongly favor a change";

  return {
    channelRef: recommendation.channelRef,
    peerRef: recommendation.peerRef,
    action: recommendation.action,
    confidence: recommendation.confidence,
    explanation: `Channel ${recommendation.channelRef}: ${actionVerb(recommendation.action)} fee ${feeSentence} because ${reasonsSentence}.`,
    evidence: {
      currentFeePpm: recommendation.currentFeePpm,
      suggestedFeePpm: recommendation.suggestedFeePpm,
      recentActivity: recommendation.signals.recentActivity,
      failedForwardPressure: recommendation.signals.failedForwardPressure,
      liquidityImbalance: recommendation.signals.liquidityImbalance,
      currentFeeBand: recommendation.signals.currentFeeBand,
      missionReliabilityBand: recommendation.signals.missionReliabilityBand,
      centralityBand: recommendation.signals.centralityBand,
      reasons,
    },
  };
};

const buildRankExplanation = (
  ranking: ArbBundle["recommendation"]["forwardOpportunityRanking"][number]
): ForwardRankingExplanation => ({
  rank: ranking.rank,
  channelRef: ranking.channelRef,
  peerRef: ranking.peerRef,
  score: ranking.score,
  explanation:
    `Channel ${ranking.channelRef} is ranked #${ranking.rank} with score ${ranking.score}. ` +
    `Signals: ${ranking.signals.forwardCount} forwards, ${ranking.signals.recentActivity} recency, ` +
    `${ranking.signals.liquidityBand} liquidity, ${ranking.signals.channelPerformanceBand} channel performance, ` +
    `${ranking.signals.peerPerformanceBand} peer performance, ${ranking.signals.missionReliabilityBand} mission reliability, ` +
    `${ranking.signals.centralityBand} centrality.`,
  evidence: {
    forwardCount: ranking.signals.forwardCount,
    recentActivity: ranking.signals.recentActivity,
    liquidityBand: ranking.signals.liquidityBand,
    channelPerformanceBand: ranking.signals.channelPerformanceBand,
    peerPerformanceBand: ranking.signals.peerPerformanceBand,
    missionReliabilityBand: ranking.signals.missionReliabilityBand,
    centralityBand: ranking.signals.centralityBand,
  },
});

const countActions = (
  feeRecommendations: ArbBundle["recommendation"]["feeRecommendations"]
): { raise: number; lower: number; hold: number } => {
  let raise = 0;
  let lower = 0;
  let hold = 0;
  for (const recommendation of feeRecommendations) {
    if (recommendation.action === "raise") raise += 1;
    else if (recommendation.action === "lower") lower += 1;
    else hold += 1;
  }
  return { raise, lower, hold };
};

export function explainRecommendations(
  arb: ArbBundle,
  request: ExplainRequest = {}
): ExplainedRecommendations {
  const verifyResult = verifyArb({ arb });
  if (!verifyResult.ok) {
    throw new Error(`Cannot explain unverified ARB: ${verifyResult.errors.join(" | ")}`);
  }

  const includeTopRanked =
    Number.isFinite(request.includeTopRanked) && (request.includeTopRanked ?? 0) > 0
      ? Math.floor(request.includeTopRanked as number)
      : 3;

  const feeRecommendationExplanations = [...arb.recommendation.feeRecommendations]
    .sort((a, b) => compareText(a.channelRef, b.channelRef))
    .map(buildFeeExplanation);

  const forwardRankingExplanations = [...arb.recommendation.forwardOpportunityRanking]
    .sort((a, b) => a.rank - b.rank || compareText(a.channelRef, b.channelRef))
    .slice(0, includeTopRanked)
    .map(buildRankExplanation);

  const actionCounts = countActions(arb.recommendation.feeRecommendations);
  const topRankedChannels = [...arb.recommendation.forwardOpportunityRanking]
    .sort((a, b) => a.rank - b.rank || compareText(a.channelRef, b.channelRef))
    .slice(0, includeTopRanked)
    .map((item) => item.channelRef);

  return {
    schemaVersion: "recommendations-explained-v1",
    generatedAt: new Date().toISOString(),
    recommendationType: "fee_forward",
    arbReference: {
      arbVersion: arb.arbVersion,
      modelVersion: arb.modelVersion,
      privacyPolicyId: arb.privacyPolicyId,
      outputHash: arb.outputHash,
      signatureDigest: arb.signature.digest,
    },
    request: {
      question: request.question?.trim() || null,
    },
    summary: {
      totalFeeRecommendations: arb.recommendation.feeRecommendations.length,
      actionCounts,
      topRankedChannels,
    },
    feeRecommendationExplanations,
    forwardRankingExplanations,
  };
}
