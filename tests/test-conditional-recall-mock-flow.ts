import assert from "node:assert/strict";
import { createApiServer } from "../src/api/server";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";

const readText = (value: unknown): string => String(value ?? "").trim();

const buildMockChannelHints = () => {
  const snapshot = getMockLightningSnapshot();
  const localPubkey = readText(snapshot.nodeInfo?.identityPubkey || snapshot.nodeInfo?.identity_pubkey).toLowerCase();
  const feePpmByChannelId = Object.fromEntries(
    (snapshot.feePolicies || [])
      .filter((policy) => readText(policy.directionPubKey || policy.direction_pub_key).toLowerCase() === localPubkey)
      .map((policy) => [readText(policy.channelId || policy.channel_id), Number(policy.feeRatePpm || policy.fee_rate_ppm || 0)])
  );

  return (snapshot.channels || []).map((channel, index) => ({
    channelId: readText(channel.chanId || channel.chan_id),
    channelRef: `channel_${String(index + 1).padStart(4, "0")}`,
    currentFeePpm: feePpmByChannelId[readText(channel.chanId || channel.chan_id)] ?? null,
  }));
};

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { status: response.status, body: await response.json() };
}

async function waitForCompletion(baseUrl: string, sessionId: string, timeoutMs = 5000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await getJson(`${baseUrl}/api/cr/sessions/${sessionId}`);
    if (response.body?.status?.state === "completed") {
      return response.body.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Conditional Recall mock session ${sessionId} did not complete in time.`);
}

async function main(): Promise<void> {
  process.env.LIGHTNING_SNAPSHOT_MODE = "mock";

  const server = createApiServer();
  const port = 8792;
  await new Promise<void>((resolve) => server.listen(port, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const channelHints = buildMockChannelHints();
    assert.ok(channelHints.length > 0, "mock channel hints should exist");

    const configTest = await postJson(`${baseUrl}/api/cr/config/test`, {
      routerConfig: {
        restHost: "mock-lightning.local",
        macaroonHex: "mock-conditional-recall",
        allowSelfSigned: true,
      },
    });
    assert.equal(configTest.status, 200, "mock config test should succeed");
    assert.equal(configTest.body.ok, true);

    const cancelable = await postJson(`${baseUrl}/api/cr/sessions`, {
      routerConfig: {
        restHost: "mock-lightning.local",
        macaroonHex: "mock-conditional-recall",
        allowSelfSigned: true,
      },
      lookbackDays: 14,
      liveWindowSeconds: 5,
      channelHints,
    });
    assert.equal(cancelable.status, 200, "cancelable session should start");
    const cancelSessionId = cancelable.body.sessionId;

    const cancelResponse = await postJson(`${baseUrl}/api/cr/sessions/${cancelSessionId}/cancel`, {});
    assert.equal(cancelResponse.status, 200, "mock cancel should succeed");
    assert.equal(cancelResponse.body.status.state, "canceled");

    const completed = await postJson(`${baseUrl}/api/cr/sessions`, {
      routerConfig: {
        restHost: "mock-lightning.local",
        macaroonHex: "mock-conditional-recall",
        allowSelfSigned: true,
      },
      lookbackDays: 14,
      liveWindowSeconds: 5,
      channelHints,
    });
    assert.equal(completed.status, 200, "completed session should start");
    const completedSessionId = completed.body.sessionId;

    const finalStatus = await waitForCompletion(baseUrl, completedSessionId);
    assert.equal(finalStatus.state, "completed", "mock session should complete");

    const resultResponse = await getJson(`${baseUrl}/api/cr/sessions/${completedSessionId}/result`);
    assert.equal(resultResponse.status, 200, "completed mock result should be available");
    assert.equal(resultResponse.body.result.aggregate.schemaVersion, "conditional-recall-aggregate-v1");
    assert.ok(resultResponse.body.result.aggregate.channels.length > 0, "mock aggregate should contain channel rows");

    console.log("Conditional Recall mock flow test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Conditional Recall mock flow test failed.", error);
  process.exitCode = 1;
});
