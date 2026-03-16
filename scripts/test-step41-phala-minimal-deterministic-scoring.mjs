import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step41.phala-minimal-deterministic-scoring.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8803;

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

const sampleTelemetry = {
  nodeAlias: "phala-score-node",
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
    {
      channelId: "300x1x0",
      peerPubkey: "04cccc",
      active: true,
      localBalanceSat: 500000,
      remoteBalanceSat: 500000,
      outboundFeePpm: 400,
      forwardCount: 2,
      revenueSat: 60,
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step41-test",
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

    const recommendResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });
    const invalidResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: { nodeAlias: "bad-recommend" },
    });

    assert(recommendResponse.status === 200, "Step41 failed: recommend response did not return 200.");
    assert(invalidResponse.status === 400, "Step41 failed: invalid recommend payload should return 400.");

    const recommendationSet = recommendResponse.body.recommendationSet;
    const feeRecommendations = recommendationSet?.feeRecommendations || [];

    assert(recommendResponse.body.mode === "deterministic_scoring_prototype", "Step41 failed: recommend mode mismatch.");
    assert(recommendResponse.body.modelVersion === "prototype-fee-forward-v1", "Step41 failed: modelVersion mismatch.");
    assert(recommendResponse.body.privacyMode === "feature_only", "Step41 failed: recommend privacy mode mismatch.");
    assert(recommendResponse.body.transformedSnapshot?.channelCount === 3, "Step41 failed: transformed snapshot channelCount mismatch.");
    assert(feeRecommendations.length === 3, "Step41 failed: expected 3 fee recommendations.");

    const firstRecommendation = feeRecommendations[0];
    const secondRecommendation = feeRecommendations[1];
    const thirdRecommendation = feeRecommendations[2];

    assert(firstRecommendation.channelRef === "channel_0001", "Step41 failed: first channel ref mismatch.");
    assert(firstRecommendation.action === "raise", "Step41 failed: first channel should be raise.");
    assert(firstRecommendation.suggestedFeePpm === 220, "Step41 failed: first channel suggested fee mismatch.");
    assert(firstRecommendation.reasons.includes("strong_recent_forward_activity"), "Step41 failed: first channel reasons missing activity signal.");

    assert(secondRecommendation.channelRef === "channel_0002", "Step41 failed: second channel ref mismatch.");
    assert(secondRecommendation.action === "lower", "Step41 failed: second channel should be lower.");
    assert(secondRecommendation.suggestedFeePpm === 1100, "Step41 failed: second channel suggested fee mismatch.");
    assert(secondRecommendation.reasons.includes("failed_forward_pressure"), "Step41 failed: second channel reasons missing failed_forward_pressure.");

    assert(thirdRecommendation.channelRef === "channel_0003", "Step41 failed: third channel ref mismatch.");
    assert(thirdRecommendation.action === "hold", "Step41 failed: third channel should be hold.");
    assert(thirdRecommendation.suggestedFeePpm === 400, "Step41 failed: third channel suggested fee mismatch.");
    assert(thirdRecommendation.reasons.includes("channel_state_is_balanced"), "Step41 failed: third channel reasons missing balanced signal.");

    assert(recommendationSet?.summary?.raiseCount === 1, "Step41 failed: raiseCount mismatch.");
    assert(recommendationSet?.summary?.lowerCount === 1, "Step41 failed: lowerCount mismatch.");
    assert(recommendationSet?.summary?.holdCount === 1, "Step41 failed: holdCount mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("deterministic_scoring_prototype"), "Step41 failed: compose scaffold missing scoring mode.");
    assert(composeSource.includes("prototype-fee-forward-v1"), "Step41 failed: compose scaffold missing modelVersion.");

    const artifact = {
      schemaVersion: "step41-phala-minimal-deterministic-scoring-v1",
      sampleTelemetry,
      recommendResponse: recommendResponse.body,
      invalidResponse: invalidResponse.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype recommend endpoint performs deterministic fee scoring over feature-only transformed telemetry and returns stable raise/lower/hold actions.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 41 artifact: ${ARTIFACT_PATH}`);
    console.log(`Deterministic recommend ok: ${recommendResponse.body.ok === true}`);
    console.log(`Invalid payload rejected: ${invalidResponse.status === 400}`);
    console.log("Step 41 phala minimal deterministic scoring test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 41 phala minimal deterministic scoring test failed.", error);
  process.exitCode = 1;
});
