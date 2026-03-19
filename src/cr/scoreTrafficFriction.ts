import type {
  ConditionalRecallAggregateChannel,
  FeeAdjustmentSuggestionV1,
} from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const roundToNearest = (value: number, step: number): number => {
  if (!Number.isFinite(value) || step <= 0) return 0;
  return Math.max(0, Math.round(value / step) * step);
};

export const deriveFrictionMetrics = (
  channel: Omit<
    ConditionalRecallAggregateChannel,
    "successRate" | "failureRate" | "failurePressure" | "volumePressure" | "frictionScore"
  >
): Pick<
  ConditionalRecallAggregateChannel,
  "successRate" | "failureRate" | "failurePressure" | "volumePressure" | "frictionScore"
> => {
  const attempts = Math.max(0, channel.attempts);
  const settles = Math.max(0, channel.settles);
  const failureCount = Math.max(0, channel.forwardFails + channel.linkFails);
  const observedVolume = Math.max(0, channel.totalAmtInSat + channel.totalAmtOutSat);
  const failedVolume = Math.max(0, channel.failedAmtSat);

  const successRate = attempts > 0 ? settles / attempts : settles > 0 ? 1 : 0;
  const failureRate = attempts > 0 ? failureCount / attempts : 0;
  const failurePressure = failureCount > 0 ? failureCount / Math.max(1, settles + failureCount) : 0;
  const volumePressure = failedVolume > 0 ? failedVolume / Math.max(1, observedVolume + failedVolume) : 0;
  const frictionScore = clamp(
    round(
      100 *
        clamp(
          0.45 * failureRate +
            0.35 * (1 - successRate) +
            0.2 * volumePressure,
          0,
          1
        ),
      2
    ),
    0,
    100
  );

  return {
    successRate: round(successRate, 4),
    failureRate: round(failureRate, 4),
    failurePressure: round(failurePressure, 4),
    volumePressure: round(volumePressure, 4),
    frictionScore,
  };
};

export const buildFeeAdjustmentSuggestions = (
  channels: ConditionalRecallAggregateChannel[]
): FeeAdjustmentSuggestionV1[] => {
  const suggestions: FeeAdjustmentSuggestionV1[] = [];

  for (const channel of channels) {
    const activity = channel.attempts + channel.settles + channel.forwardFails + channel.linkFails;
    const failureCount = channel.forwardFails + channel.linkFails;
    const currentFeePpm = Number.isFinite(Number(channel.currentFeePpm))
      ? Number(channel.currentFeePpm)
      : 0;

    if (activity < 3) {
      continue;
    }

    if (channel.frictionScore >= 55 && failureCount >= 2) {
      const increment = Math.max(25, roundToNearest(currentFeePpm * 0.15 + channel.frictionScore * 1.5, 25));
      suggestions.push({
        channelRef: channel.channelRef,
        action: "raise",
        frictionScore: channel.frictionScore,
        confidence: clamp(round(0.45 + channel.failurePressure * 0.35 + channel.volumePressure * 0.2, 2), 0, 1),
        currentFeePpm,
        suggestedFeePpm: currentFeePpm + increment,
        reasons: [
          `Failure pressure ${Math.round(channel.failurePressure * 100)}% over the active window`,
          `Friction score ${Math.round(channel.frictionScore)} from repeated forward or link failures`,
        ],
        windowStart: channel.windowStart,
        windowEnd: channel.windowEnd,
      });
      continue;
    }

    if (channel.frictionScore <= 18 && activity <= 8 && currentFeePpm >= 250) {
      const nextFee = Math.max(0, currentFeePpm - Math.max(25, roundToNearest(currentFeePpm * 0.15, 25)));
      suggestions.push({
        channelRef: channel.channelRef,
        action: "lower",
        frictionScore: channel.frictionScore,
        confidence: clamp(round(0.35 + (1 - channel.failureRate) * 0.25, 2), 0, 1),
        currentFeePpm,
        suggestedFeePpm: nextFee,
        reasons: [
          `Low activity over the collection window`,
          `Current fee ${currentFeePpm} ppm is high relative to observed friction`,
        ],
        windowStart: channel.windowStart,
        windowEnd: channel.windowEnd,
      });
    }
  }

  return suggestions.sort((left, right) => right.frictionScore - left.frictionScore || left.channelRef.localeCompare(right.channelRef));
};
