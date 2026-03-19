import assert from "node:assert/strict";
import type { ConditionalRecallResult, ConditionalRecallSessionManager, ConditionalRecallStatus } from "../src/cr/types";
import { createApiServer } from "../src/api/server";

interface FakeSessionRecord {
  status: ConditionalRecallStatus;
  result: ConditionalRecallResult | null;
}

const buildStatus = (sessionId: string, state: ConditionalRecallStatus["state"]): ConditionalRecallStatus => ({
  sessionId,
  state,
  startedAt: "2026-03-19T00:00:00.000Z",
  endsAt: state === "completed" || state === "canceled" ? "2026-03-19T00:05:00.000Z" : null,
  progress: {
    historyEventsProcessed: 12,
    liveEventsProcessed: 3,
    channelsTracked: state === "completed" || state === "canceled" ? 0 : 4,
  },
  error: null,
  configSummary: {
    restHost: "localhost:8080",
    allowSelfSigned: true,
    lookbackDays: 14,
    liveWindowSeconds: 300,
    channelHintCount: 2,
  },
});

const sampleResult: ConditionalRecallResult = {
  aggregate: {
    schemaVersion: "conditional-recall-aggregate-v1",
    collectedAt: "2026-03-19T00:05:00.000Z",
    windowStart: "2026-03-05T00:00:00.000Z",
    windowEnd: "2026-03-19T00:05:00.000Z",
    lookbackDays: 14,
    liveWindowSeconds: 300,
    channels: [
      {
        channelRef: "channel_0001",
        attempts: 4,
        settles: 3,
        forwardFails: 1,
        linkFails: 0,
        totalAmtInSat: 1000,
        totalAmtOutSat: 900,
        failedAmtSat: 50,
        observedFeeSat: 10,
        currentFeePpm: 50,
        successRate: 0.75,
        failureRate: 0.25,
        failurePressure: 0.25,
        volumePressure: 0.03,
        frictionScore: 27,
        windowStart: "2026-03-05T00:00:00.000Z",
        windowEnd: "2026-03-19T00:05:00.000Z",
      },
    ],
  },
  suggestions: [],
  collectionSummary: {
    startedAt: "2026-03-19T00:00:00.000Z",
    completedAt: "2026-03-19T00:05:00.000Z",
    windowStart: "2026-03-05T00:00:00.000Z",
    windowEnd: "2026-03-19T00:05:00.000Z",
    historyEventsProcessed: 12,
    liveEventsProcessed: 3,
    channelsTracked: 1,
  },
};

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function main(): Promise<void> {
  let counter = 0;
  const sessions = new Map<string, FakeSessionRecord>();

  const fakeManager: ConditionalRecallSessionManager = {
    async testConfig(routerConfig) {
      return {
        ok: true,
        restHost: routerConfig.restHost,
        allowSelfSigned: routerConfig.allowSelfSigned,
        forwardingHistoryReachable: true,
        htlcStreamReachable: true,
      };
    },
    async startSession() {
      counter += 1;
      const sessionId = `session-${counter}`;
      const status = buildStatus(sessionId, "streaming_live");
      sessions.set(sessionId, { status, result: null });
      return { ok: true, sessionId, status };
    },
    getStatus(sessionId) {
      return sessions.get(sessionId)?.status || null;
    },
    getResult(sessionId) {
      return sessions.get(sessionId)?.result || null;
    },
    async cancelSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      session.status = buildStatus(sessionId, "canceled");
      return session.status;
    },
  };

  const server = createApiServer({
    conditionalRecallSessionManager: fakeManager,
  });
  const port = 8791;
  await new Promise<void>((resolve) => server.listen(port, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;

    const configTestResponse = await postJson(`${baseUrl}/api/cr/config/test`, {
      routerConfig: {
        restHost: "localhost:8080",
        macaroonHex: "00",
        allowSelfSigned: true,
      },
    });
    assert.equal(configTestResponse.status, 200, "config test should succeed");
    assert.equal(configTestResponse.body.ok, true);

    const startResponse = await postJson(`${baseUrl}/api/cr/sessions`, {
      routerConfig: {
        restHost: "localhost:8080",
        macaroonHex: "00",
        allowSelfSigned: true,
      },
      lookbackDays: 14,
      liveWindowSeconds: 60,
      channelHints: [
        { channelId: "111", channelRef: "channel_0001", currentFeePpm: 50 },
      ],
    });
    assert.equal(startResponse.status, 200, "session start should succeed");
    const sessionId = startResponse.body.sessionId;

    const statusResponse = await getJson(`${baseUrl}/api/cr/sessions/${sessionId}`);
    assert.equal(statusResponse.status, 200, "status polling should succeed");
    assert.equal(statusResponse.body.status.state, "streaming_live");

    const pendingResultResponse = await getJson(`${baseUrl}/api/cr/sessions/${sessionId}/result`);
    assert.equal(pendingResultResponse.status, 409, "result should fail before completion");

    const cancelResponse = await postJson(`${baseUrl}/api/cr/sessions/${sessionId}/cancel`, {});
    assert.equal(cancelResponse.status, 200, "cancel should succeed");
    assert.equal(cancelResponse.body.status.state, "canceled");

    const completedSessionId = "session-2";
    sessions.set(completedSessionId, {
      status: buildStatus(completedSessionId, "completed"),
      result: sampleResult,
    });
    const completedResultResponse = await getJson(`${baseUrl}/api/cr/sessions/${completedSessionId}/result`);
    assert.equal(completedResultResponse.status, 200, "completed result should succeed");
    assert.equal(completedResultResponse.body.result.aggregate.schemaVersion, "conditional-recall-aggregate-v1");

    console.log("Conditional Recall API test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Conditional Recall API test failed.", error);
  process.exitCode = 1;
});
