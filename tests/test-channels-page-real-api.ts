import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApiServer } from "../src/api/server";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { selectChannelPropsRecommendation } from "../src/pages/channelsPropsFlow";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "channels-page-real-api.json");
const CHANNELS_PAGE_PATH = path.resolve(process.cwd(), "src", "pages", "ChannelsPage.jsx");
const PORT = 8796;
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const stableJson = (value: unknown): string => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function postJson(
  url: string,
  payload: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function main(): Promise<void> {
  const mockSnapshot = getMockLightningSnapshot();
  const telemetry = snapshotToFrontendTelemetry(mockSnapshot);
  const selectedChannelId = String(mockSnapshot.channels[0]?.chanId || "");
  const fallbackFeePpm = Number(mockSnapshot.feePolicies[0]?.feeRatePpm || 0);

  assert(selectedChannelId.length > 0, "Channels Page Real Api failed: mock snapshot did not provide a selected channel.");

  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const recommendResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(recommendResponse.status === 200, "Channels Page Real Api failed: recommend request did not return 200.");

    const verifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arb: recommendResponse.body.arb,
      sourceProvenance: recommendResponse.body.sourceProvenance,
      now: FIXED_VERIFY_NOW,
    });
    assert(verifyResponse.status === 200, "Channels Page Real Api failed: verify request did not return 200.");
    assert(verifyResponse.body.ok === true, "Channels Page Real Api failed: verify request did not pass.");

    const mappedRecommendation = selectChannelPropsRecommendation({
      recommendResponse: recommendResponse.body,
      verifyResponse: verifyResponse.body,
      selectedChannelId,
      nodeChannels: mockSnapshot.channels,
      fallbackFeePpm,
    });

    assert(mappedRecommendation, "Channels Page Real Api failed: no mapped recommendation was found for the selected channel.");
    assert(
      ["Raise", "Lower", "Hold"].includes(String(mappedRecommendation.action)),
      "Channels Page Real Api failed: mapped recommendation action is invalid."
    );
    assert(
      String(mappedRecommendation.channelRef || "").startsWith("channel_"),
      "Channels Page Real Api failed: mapped recommendation channelRef is missing."
    );
    assert(mappedRecommendation.verifyOk === true, "Channels Page Real Api failed: mapped recommendation should be verified.");

    const channelsPageSource = await readFile(CHANNELS_PAGE_PATH, "utf8");
    const mockRemoved = !channelsPageSource.includes("MOCK_RECOMMENDATION_API");
    const realApiWired =
      channelsPageSource.includes("postRecommend") &&
      channelsPageSource.includes("postVerify") &&
      channelsPageSource.includes("selectChannelPropsRecommendation");

    assert(mockRemoved, "Channels Page Real Api failed: ChannelsPage still contains MOCK_RECOMMENDATION_API.");
    assert(realApiWired, "Channels Page Real Api failed: ChannelsPage does not appear to be wired to the real API flow.");

    const artifact = {
      schemaVersion: "channels-page-real-api-v1",
      selectedChannelId,
      mappedRecommendation,
      sourceChecks: {
        mockRemoved,
        realApiWired,
      },
      doneCondition:
        "ChannelsPage no longer uses the local mock recommendation path and can map a verified API recommendation back onto the selected channel flow.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Channels Page Real Api artifact: ${ARTIFACT_PATH}`);
    console.log(`Mapped channel recommendation: ${mappedRecommendation.channelRef}`);
    console.log(`Mock removed: ${mockRemoved}`);
    console.log("Channels Page Real Api test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Channels Page Real Api test failed.", error);
  process.exitCode = 1;
});

