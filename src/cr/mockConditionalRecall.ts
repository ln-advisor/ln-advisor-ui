import { getMockLightningSnapshot } from "../connectors/mockLightningSnapshot";
import { createConditionalRecallSessionManager } from "./sessionManager";
import type {
  ConditionalRecallAnalyzerDependencies,
  ConditionalRecallSessionManager,
  ForwardingHistoryEventLike,
  HtlcEventLike,
  RouterHtlcEventsStreamOptions,
} from "./types";

const MOCK_FORWARD_EVENTS: HtlcEventLike[] = [
  {
    event_type: "FORWARD",
    incoming_channel_id: "124x1x0",
    outgoing_channel_id: "123x1x0",
    timestamp_ns: "1767225600000000000",
    forward_event: {
      info: {
        incoming_amt_msat: "140000000",
        outgoing_amt_msat: "139100000",
      },
    },
  },
  {
    event_type: "FORWARD",
    incoming_channel_id: "124x1x0",
    outgoing_channel_id: "123x1x0",
    timestamp_ns: "1767225601000000000",
    forward_fail_event: {},
  },
  {
    event_type: "FORWARD",
    incoming_channel_id: "124x1x0",
    outgoing_channel_id: "123x1x0",
    timestamp_ns: "1767225602000000000",
    link_fail_event: {
      info: {
        incoming_amt_msat: "90000000",
        outgoing_amt_msat: "89000000",
      },
    },
  },
  {
    event_type: "FORWARD",
    incoming_channel_id: "123x1x0",
    outgoing_channel_id: "124x1x0",
    timestamp_ns: "1767225603000000000",
    settle_event: {},
  },
  {
    event_type: "FORWARD",
    incoming_channel_id: "125x1x0",
    outgoing_channel_id: "124x1x0",
    timestamp_ns: "1767225604000000000",
    forward_event: {
      info: {
        incoming_amt_msat: "50000000",
        outgoing_amt_msat: "49900000",
      },
    },
  },
];

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const buildMockForwardingHistory = (): ForwardingHistoryEventLike[] => {
  const snapshot = getMockLightningSnapshot();
  return [...(snapshot.forwardingHistory || [])].sort((left, right) =>
    compareText(String(left.timestamp || ""), String(right.timestamp || ""))
  );
};

const buildMockDependencies = (): Partial<ConditionalRecallAnalyzerDependencies> => ({
  fetchForwardingHistory: async (_config, _lookbackDays, onProgress) => {
    const events = buildMockForwardingHistory();
    if (onProgress) {
      onProgress(events.length);
    }
    return events;
  },
  openRouterHtlcEventsStream: async (
    options: RouterHtlcEventsStreamOptions
  ) => {
    let closed = false;
    const timers = MOCK_FORWARD_EVENTS.map((event, index) =>
      setTimeout(() => {
        if (closed) return;
        options.onEvent(event);
      }, 25 * (index + 1))
    );

    return {
      waitForOpen: async () => undefined,
      close: () => {
        closed = true;
        timers.forEach((timer) => clearTimeout(timer));
      },
    };
  },
  setTimer: (callback, delayMs) => setTimeout(callback, Math.max(100, Math.round(delayMs * 0.02))),
  clearTimer: (handle) => clearTimeout(handle),
});

export const createMockConditionalRecallSessionManager = (): ConditionalRecallSessionManager =>
  createConditionalRecallSessionManager(buildMockDependencies());
