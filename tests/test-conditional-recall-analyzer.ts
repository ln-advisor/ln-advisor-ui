import assert from "node:assert/strict";
import { HtlcTrafficAnalyzer } from "../src/cr/htlcTrafficAnalyzer";
import { buildFeeAdjustmentSuggestions } from "../src/cr/scoreTrafficFriction";

const BASE_CONFIG = {
  routerConfig: {
    restHost: "localhost:8080",
    macaroonHex: "00",
    allowSelfSigned: true,
  },
  lookbackDays: 14,
  liveWindowSeconds: 30,
  channelHints: [
    { channelId: "111", channelRef: "channel_0001", currentFeePpm: 50 },
    { channelId: "222", channelRef: "channel_0002", currentFeePpm: 900 },
  ],
};

const dependencies = {
  fetchForwardingHistory: async () => [],
  openRouterHtlcEventsStream: async () => ({
    waitForOpen: async () => undefined,
    close: () => undefined,
  }),
  setTimer: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clearTimer: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  now: () => Date.parse("2026-03-19T00:00:00Z"),
};

async function main(): Promise<void> {
  const analyzer = new HtlcTrafficAnalyzer(BASE_CONFIG, dependencies);

  const historyProcessed = analyzer.ingestForwardingHistoryRows([
    {
      chan_id_in: "111",
      chan_id_out: "222",
      amt_in: "50000",
      amt_out: "49000",
      fee: "1000",
      timestamp: "1710000000",
    },
    {
      chan_id_in: "111",
      chan_id_out: "222",
      amt_in: "60000",
      amt_out: "59000",
      fee: "1000",
      timestamp: "1710000600",
    },
  ]);

  assert.equal(historyProcessed, 2, "history baseline should be aggregated");
  assert.equal(
    analyzer.ingestHtlcEvent({
      event_type: "FORWARD",
      incoming_channel_id: "111",
      outgoing_channel_id: "222",
      timestamp_ns: "1710000900000000000",
      forward_event: {
        info: {
          incoming_amt_msat: "80000000",
          outgoing_amt_msat: "79000000",
        },
      },
    }),
    true,
    "forward event should update attempts"
  );
  assert.equal(
    analyzer.ingestHtlcEvent({
      event_type: "FORWARD",
      incoming_channel_id: "111",
      outgoing_channel_id: "222",
      timestamp_ns: "1710000910000000000",
      link_fail_event: {
        info: {
          incoming_amt_msat: "81000000",
          outgoing_amt_msat: "80000000",
        },
      },
    }),
    true,
    "link fail event should update failure pressure"
  );
  assert.equal(
    analyzer.ingestHtlcEvent({
      event_type: "FORWARD",
      incoming_channel_id: "111",
      outgoing_channel_id: "222",
      timestamp_ns: "1710000920000000000",
      forward_fail_event: {},
    }),
    true,
    "forward fail event should be counted"
  );
  assert.equal(
    analyzer.ingestHtlcEvent({
      event_type: "FORWARD",
      incoming_channel_id: "111",
      outgoing_channel_id: "222",
      timestamp_ns: "1710000930000000000",
      forward_fail_event: {},
    }),
    true,
    "repeated forward fail events should raise friction"
  );
  assert.equal(
    analyzer.ingestHtlcEvent({
      event_type: "SEND",
      incoming_channel_id: "111",
      outgoing_channel_id: "222",
    }),
    false,
    "non-forward events should be ignored"
  );
  assert.equal(analyzer.ingestHtlcEvent(null as any), false, "malformed events should be ignored");

  const result = analyzer.flushAndAnalyze();
  const statusAfterFlush = analyzer.getStatus("test-session");

  assert.equal(statusAfterFlush.state, "completed", "flush should mark the analyzer as completed");
  assert.equal(statusAfterFlush.progress.channelsTracked, 0, "flush should wipe tracked channels");
  assert.equal(result.aggregate.channels.length, 2, "aggregate should retain only reduced channel rows");
  assert.ok(result.suggestions.length >= 1, "high-friction channel should produce a draft suggestion");

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("111"), false, "raw channel id 111 must not leak into the final result");
  assert.equal(serialized.includes("222"), false, "raw channel id 222 must not leak into the final result");

  const recomputedSuggestions = buildFeeAdjustmentSuggestions(result.aggregate.channels);
  assert.deepEqual(
    result.suggestions,
    recomputedSuggestions,
    "deterministic scoring should be stable for the same aggregate input"
  );

  const cancelAnalyzer = new HtlcTrafficAnalyzer(BASE_CONFIG, dependencies);
  cancelAnalyzer.ingestForwardingHistoryRows([
    {
      chan_id_in: "111",
      chan_id_out: "222",
      amt_in: "1000",
      amt_out: "900",
      fee: "100",
      timestamp: "1710000000",
    },
  ]);
  await cancelAnalyzer.cancel();
  const canceledStatus = cancelAnalyzer.getStatus("cancel-session");
  assert.equal(canceledStatus.state, "canceled", "cancel should move the analyzer into the canceled state");
  assert.equal(canceledStatus.progress.channelsTracked, 0, "cancel should wipe tracked channels");

  console.log("Conditional Recall analyzer test: PASS");
}

main().catch((error) => {
  console.error("Conditional Recall analyzer test failed.", error);
  process.exitCode = 1;
});
