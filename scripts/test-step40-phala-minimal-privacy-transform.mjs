import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step40.phala-minimal-privacy-transform.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8802;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value) => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const record = value;
    const sorted = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const stableJson = (value) => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { status: response.status, body };
}

const payloadContainsKey = (value, targetKey) => {
  if (Array.isArray(value)) return value.some((item) => payloadContainsKey(item, targetKey));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, child]) => key === targetKey || payloadContainsKey(child, targetKey));
  }
  return false;
};

const sampleTelemetry = {
  nodeAlias: "phala-prototype-node",
  channels: [
    {
      channelId: "200x1x0",
      peerPubkey: "03bbbb",
      active: false,
      localBalanceSat: 150000,
      remoteBalanceSat: 850000,
      outboundFeePpm: 1200,
      forwardCount: 1,
      revenueSat: 12,
      failedForwardCount: 2,
    },
    {
      channelId: "100x1x0",
      peerPubkey: "02aaaa",
      active: true,
      localBalanceSat: 800000,
      remoteBalanceSat: 200000,
      outboundFeePpm: 120,
      forwardCount: 9,
      revenueSat: 450,
      failedForwardCount: 0,
    },
  ],
};

async function main() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(PORT),
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step40-test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await sleep(750);

    const featureOnlyResponse = await postJson(`http://127.0.0.1:${PORT}/api/snapshot`, {
      telemetry: sampleTelemetry,
      privacyMode: "feature_only",
    });
    const bandedResponse = await postJson(`http://127.0.0.1:${PORT}/api/snapshot`, {
      telemetry: sampleTelemetry,
      privacyMode: "banded",
    });
    const invalidResponse = await postJson(`http://127.0.0.1:${PORT}/api/snapshot`, {
      telemetry: { nodeAlias: "bad-payload" },
    });

    assert(featureOnlyResponse.status === 200, "Step40 failed: feature_only snapshot did not return 200.");
    assert(bandedResponse.status === 200, "Step40 failed: banded snapshot did not return 200.");
    assert(invalidResponse.status === 400, "Step40 failed: invalid snapshot payload should return 400.");

    const featureOnly = featureOnlyResponse.body.transformedSnapshot;
    const banded = bandedResponse.body.transformedSnapshot;

    assert(featureOnlyResponse.body.mode === "privacy_transform_prototype", "Step40 failed: feature_only mode mismatch.");
    assert(featureOnly?.privacyMode === "feature_only", "Step40 failed: feature_only privacy mode missing.");
    assert(featureOnly?.channelCount === 2, "Step40 failed: feature_only channelCount mismatch.");
    assert(featureOnly?.channels?.[0]?.channelRef === "channel_0001", "Step40 failed: channel refs are not deterministic.");
    assert(featureOnly?.channels?.[0]?.peerRef === "peer_0001", "Step40 failed: peer refs are not deterministic.");
    assert(featureOnly?.channels?.[0]?.localBalanceRatio === 0.8, "Step40 failed: local ratio for first sorted channel mismatch.");
    assert(featureOnly?.channels?.[1]?.localBalanceRatio === 0.15, "Step40 failed: local ratio for second sorted channel mismatch.");
    assert(!payloadContainsKey(featureOnly, "channelId"), "Step40 failed: feature_only output leaked channelId.");
    assert(!payloadContainsKey(featureOnly, "peerPubkey"), "Step40 failed: feature_only output leaked peerPubkey.");
    assert(!payloadContainsKey(featureOnly, "localBalanceSat"), "Step40 failed: feature_only output leaked localBalanceSat.");
    assert(!payloadContainsKey(featureOnly, "remoteBalanceSat"), "Step40 failed: feature_only output leaked remoteBalanceSat.");

    assert(bandedResponse.body.mode === "privacy_transform_prototype", "Step40 failed: banded mode mismatch.");
    assert(banded?.privacyMode === "banded", "Step40 failed: banded privacy mode missing.");
    assert(banded?.channels?.[0]?.liquidityBand === "HIGH", "Step40 failed: first channel liquidity band mismatch.");
    assert(banded?.channels?.[1]?.liquidityBand === "LOW", "Step40 failed: second channel liquidity band mismatch.");
    assert(banded?.channels?.[0]?.channelPerformanceBand === "HIGH", "Step40 failed: first channel performance band mismatch.");
    assert(banded?.channels?.[1]?.failedForwardPressure === "HIGH", "Step40 failed: second channel failed-forward pressure mismatch.");
    assert(!payloadContainsKey(banded, "localBalanceRatio"), "Step40 failed: banded output leaked localBalanceRatio.");
    assert(!payloadContainsKey(banded, "outboundFeePpm"), "Step40 failed: banded output leaked outboundFeePpm.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("privacy_transform_prototype"), "Step40 failed: compose scaffold was not updated for the privacy transform.");
    assert(composeSource.includes("prototype-privacy-node-state-v1"), "Step40 failed: compose scaffold is missing the transformed schema.");

    const artifact = {
      schemaVersion: "step40-phala-minimal-privacy-transform-v1",
      sampleTelemetry,
      featureOnlyResponse: featureOnlyResponse.body,
      bandedResponse: bandedResponse.body,
      invalidResponse: invalidResponse.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype snapshot endpoint performs a deterministic privacy transform over input telemetry and returns feature-only or banded output without leaking exact balances or identifiers.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 40 artifact: ${ARTIFACT_PATH}`);
    console.log(`Feature-only transform ok: ${featureOnlyResponse.body.ok === true}`);
    console.log(`Banded transform ok: ${bandedResponse.body.ok === true}`);
    console.log(`Invalid payload rejected: ${invalidResponse.status === 400}`);
    console.log("Step 40 phala minimal privacy transform test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 40 phala minimal privacy transform test failed.", error);
  process.exitCode = 1;
});
