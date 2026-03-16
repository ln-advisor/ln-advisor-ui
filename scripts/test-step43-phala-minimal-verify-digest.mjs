import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step43.phala-minimal-verify-digest.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8805;

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
  nodeAlias: "phala-verify-node",
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step43-test",
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

    assert(recommendResponse.status === 200, "Step43 failed: recommend response did not return 200.");

    const verifyPass = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: recommendResponse.body.arb,
    });

    const tamperedRecommendationSet = sortObjectKeysDeep(recommendResponse.body.recommendationSet);
    tamperedRecommendationSet.feeRecommendations[0].suggestedFeePpm = 9999;

    const verifyFail = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: tamperedRecommendationSet,
      arb: recommendResponse.body.arb,
    });

    assert(verifyPass.status === 200, "Step43 failed: verify pass response did not return 200.");
    assert(verifyFail.status === 200, "Step43 failed: verify fail response did not return 200.");
    assert(verifyPass.body.mode === "prototype_digest_verify", "Step43 failed: verify mode mismatch.");
    assert(verifyPass.body.ok === true, "Step43 failed: valid digest verification should pass.");
    assert(Array.isArray(verifyPass.body.errors) && verifyPass.body.errors.length === 0, "Step43 failed: valid digest verification should have no errors.");
    assert(verifyFail.body.ok === false, "Step43 failed: tampered digest verification should fail.");
    assert(verifyFail.body.errors.includes("outputHash mismatch."), "Step43 failed: tampered output should trigger outputHash mismatch.");
    assert(verifyFail.body.errors.includes("digest mismatch."), "Step43 failed: tampered output should trigger digest mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("prototype_digest_verify"), "Step43 failed: compose scaffold missing verify mode.");
    assert(composeSource.includes("inputHash mismatch."), "Step43 failed: compose scaffold missing verify error checks.");

    const artifact = {
      schemaVersion: "step43-phala-minimal-verify-digest-v1",
      recommendResponse: recommendResponse.body,
      verifyPass: verifyPass.body,
      verifyFail: verifyFail.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype verify endpoint recomputes the prototype inputHash, outputHash, and digest and rejects tampered recommendation payloads.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 43 artifact: ${ARTIFACT_PATH}`);
    console.log(`Valid digest verification ok: ${verifyPass.body.ok === true}`);
    console.log(`Tampered digest rejected: ${verifyFail.body.ok === false}`);
    console.log("Step 43 phala minimal verify digest test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 43 phala minimal verify digest test failed.", error);
  process.exitCode = 1;
});
