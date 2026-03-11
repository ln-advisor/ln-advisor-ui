import type { ArbBundle } from "../arb/buildArb";
import { verifyArb } from "../arb/verifyArb";
import { explainRecommendations, type ExplainedRecommendations } from "../scoring/explainRecommendations";

export type OpenClawTaskType = "explain_recommendation" | "compare_bundles" | "draft_fee_update_commands";

export interface OpenClawTaskRequest {
  taskType: OpenClawTaskType;
  currentArb: ArbBundle;
  previousArb?: ArbBundle;
  question?: string;
  includeTopRanked?: number;
  devSigningKey?: string;
}

export interface OpenClawTaskResult {
  schemaVersion: "openclaw-workflow-v1";
  taskType: OpenClawTaskType;
  generatedAt: string;
  constraints: {
    inputsAllowed: string[];
    inputsBlocked: string[];
  };
  verification: {
    currentArbVerified: true;
    previousArbVerified?: true;
  };
  result:
    | {
        explanation: ExplainedRecommendations;
      }
    | {
        comparison: {
          currentArbOutputHash: string;
          previousArbOutputHash: string;
          modelVersionChanged: boolean;
          privacyPolicyChanged: boolean;
          feeActionChanges: Array<{
            channelRef: string;
            peerRef: string;
            previousAction: "raise" | "lower" | "hold" | "missing";
            currentAction: "raise" | "lower" | "hold" | "missing";
            previousSuggestedFeePpm: number | null;
            currentSuggestedFeePpm: number | null;
          }>;
          rankingChanges: Array<{
            channelRef: string;
            peerRef: string;
            previousRank: number | null;
            currentRank: number | null;
            rankDelta: number | null;
            previousScore: number | null;
            currentScore: number | null;
          }>;
        };
      }
    | {
      draftFeeUpdateCommands: Array<{
          channelRef: string;
          peerRef: string;
          action: "raise" | "lower";
          currentFeePpm: number;
          suggestedFeePpm: number;
          commandTemplate: string;
          note: string;
        }>;
      };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const INPUTS_ALLOWED = [
  "verified_arb_bundle",
  "verified_recommendation_payload",
  "optional_explanation_request_text",
];

const INPUTS_BLOCKED = [
  "lnc_pairing_phrase",
  "lnc_password",
  "raw_channel_balances",
  "raw_node_telemetry",
  "direct_node_write_access",
];

const verifyOrThrow = (arb: ArbBundle, devSigningKey?: string): void => {
  const verifyResult = verifyArb({ arb, devSigningKey });
  if (!verifyResult.ok) {
    throw new Error(`OpenClaw blocked: ARB verification failed (${verifyResult.errors.join(" | ")})`);
  }
};

const mapFeeByChannel = (arb: ArbBundle) => {
  const map = new Map<
    string,
    {
      peerRef: string;
      action: "raise" | "lower" | "hold";
      suggestedFeePpm: number | null;
    }
  >();
  for (const item of arb.recommendation.feeRecommendations) {
    map.set(item.channelRef, {
      peerRef: item.peerRef,
      action: item.action,
      suggestedFeePpm: item.suggestedFeePpm,
    });
  }
  return map;
};

const mapRankingByChannel = (arb: ArbBundle) => {
  const map = new Map<
    string,
    {
      peerRef: string;
      rank: number;
      score: number;
    }
  >();
  for (const item of arb.recommendation.forwardOpportunityRanking) {
    map.set(item.channelRef, {
      peerRef: item.peerRef,
      rank: item.rank,
      score: item.score,
    });
  }
  return map;
};

const runExplainTask = (request: OpenClawTaskRequest): OpenClawTaskResult => {
  const explanation = explainRecommendations(request.currentArb, {
    question: request.question,
    includeTopRanked: request.includeTopRanked,
  });

  return {
    schemaVersion: "openclaw-workflow-v1",
    taskType: "explain_recommendation",
    generatedAt: request.currentArb.issuedAt,
    constraints: {
      inputsAllowed: INPUTS_ALLOWED,
      inputsBlocked: INPUTS_BLOCKED,
    },
    verification: {
      currentArbVerified: true,
    },
    result: {
      explanation,
    },
  };
};

const runCompareTask = (request: OpenClawTaskRequest): OpenClawTaskResult => {
  if (!request.previousArb) {
    throw new Error("compare_bundles requires previousArb.");
  }

  const currentFeeMap = mapFeeByChannel(request.currentArb);
  const previousFeeMap = mapFeeByChannel(request.previousArb);
  const feeRefs = [...new Set([...currentFeeMap.keys(), ...previousFeeMap.keys()])].sort(compareText);

  const feeActionChanges = feeRefs.map((channelRef) => {
    const current = currentFeeMap.get(channelRef);
    const previous = previousFeeMap.get(channelRef);
    return {
      channelRef,
      peerRef: current?.peerRef || previous?.peerRef || "",
      previousAction: previous?.action || "missing",
      currentAction: current?.action || "missing",
      previousSuggestedFeePpm: previous?.suggestedFeePpm ?? null,
      currentSuggestedFeePpm: current?.suggestedFeePpm ?? null,
    };
  });

  const currentRankMap = mapRankingByChannel(request.currentArb);
  const previousRankMap = mapRankingByChannel(request.previousArb);
  const rankRefs = [...new Set([...currentRankMap.keys(), ...previousRankMap.keys()])].sort(compareText);

  const rankingChanges = rankRefs.map((channelRef) => {
    const current = currentRankMap.get(channelRef);
    const previous = previousRankMap.get(channelRef);
    return {
      channelRef,
      peerRef: current?.peerRef || previous?.peerRef || "",
      previousRank: previous?.rank ?? null,
      currentRank: current?.rank ?? null,
      rankDelta:
        previous?.rank !== undefined && current?.rank !== undefined
          ? previous.rank - current.rank
          : null,
      previousScore: previous?.score ?? null,
      currentScore: current?.score ?? null,
    };
  });

  return {
    schemaVersion: "openclaw-workflow-v1",
    taskType: "compare_bundles",
    generatedAt: request.currentArb.issuedAt,
    constraints: {
      inputsAllowed: INPUTS_ALLOWED,
      inputsBlocked: INPUTS_BLOCKED,
    },
    verification: {
      currentArbVerified: true,
      previousArbVerified: true,
    },
    result: {
      comparison: {
        currentArbOutputHash: request.currentArb.outputHash,
        previousArbOutputHash: request.previousArb.outputHash,
        modelVersionChanged: request.currentArb.modelVersion !== request.previousArb.modelVersion,
        privacyPolicyChanged: request.currentArb.privacyPolicyId !== request.previousArb.privacyPolicyId,
        feeActionChanges,
        rankingChanges,
      },
    },
  };
};

const runDraftTask = (request: OpenClawTaskRequest): OpenClawTaskResult => {
  const draftFeeUpdateCommands = [...request.currentArb.recommendation.feeRecommendations]
    .filter(
      (item) =>
        (item.action === "raise" || item.action === "lower") &&
        item.currentFeePpm !== null &&
        item.suggestedFeePpm !== null &&
        item.suggestedFeePpm !== item.currentFeePpm
    )
    .sort((a, b) => compareText(a.channelRef, b.channelRef))
    .map((item) => ({
      channelRef: item.channelRef,
      peerRef: item.peerRef,
      action: item.action as "raise" | "lower",
      currentFeePpm: item.currentFeePpm as number,
      suggestedFeePpm: item.suggestedFeePpm as number,
      commandTemplate:
        `lncli updatechanpolicy --chan_id=<resolve:${item.channelRef}> --fee_rate_ppm=${item.suggestedFeePpm}`,
      note:
        "Draft only. Resolve channelRef to local channelId in UI before execution.",
    }));

  return {
    schemaVersion: "openclaw-workflow-v1",
    taskType: "draft_fee_update_commands",
    generatedAt: request.currentArb.issuedAt,
    constraints: {
      inputsAllowed: INPUTS_ALLOWED,
      inputsBlocked: INPUTS_BLOCKED,
    },
    verification: {
      currentArbVerified: true,
    },
    result: {
      draftFeeUpdateCommands,
    },
  };
};

export function runOpenClawTask(request: OpenClawTaskRequest): OpenClawTaskResult {
  verifyOrThrow(request.currentArb, request.devSigningKey);
  if (request.taskType === "compare_bundles") {
    if (!request.previousArb) {
      throw new Error("compare_bundles task requires previousArb.");
    }
    verifyOrThrow(request.previousArb, request.devSigningKey);
  }

  if (request.taskType === "explain_recommendation") {
    return runExplainTask(request);
  }
  if (request.taskType === "compare_bundles") {
    return runCompareTask(request);
  }
  return runDraftTask(request);
}
