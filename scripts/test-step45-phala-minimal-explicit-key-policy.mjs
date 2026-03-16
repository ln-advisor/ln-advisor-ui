import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step45.phala-minimal-explicit-key-policy.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT_NO_KEY = 8807;
const PORT_WITH_KEY = 8808;
const EXPLICIT_SIGNING_KEY = "step45-explicit-signing-key";

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
  nodeAlias: "phala-explicit-key-node",
  channels: [
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

function startServer(port, extraEnv = {}) {
  return spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      PROTOTYPE_SERVICE_NAME: `ln-advisor-phala-minimal-step45-${port}`,
      PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY: "true",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  const firstServer = startServer(PORT_NO_KEY);
  let firstStdout = "";
  let firstStderr = "";
  firstServer.stdout.on("data", (chunk) => {
    firstStdout += chunk.toString();
  });
  firstServer.stderr.on("data", (chunk) => {
    firstStderr += chunk.toString();
  });

  const secondServer = startServer(PORT_WITH_KEY, {
    PROTOTYPE_ARB_SIGNING_KEY: EXPLICIT_SIGNING_KEY,
  });
  let secondStdout = "";
  let secondStderr = "";
  secondServer.stdout.on("data", (chunk) => {
    secondStdout += chunk.toString();
  });
  secondServer.stderr.on("data", (chunk) => {
    secondStderr += chunk.toString();
  });

  try {
    await sleep(900);

    const recommendBlocked = await postJson(`http://127.0.0.1:${PORT_NO_KEY}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(recommendBlocked.status === 503, "Step45 failed: recommend should be blocked when explicit key is required but not provided.");
    assert(recommendBlocked.body.mode === "prototype_signer_provider", "Step45 failed: blocked recommend mode mismatch.");
    assert(recommendBlocked.body.error === "Explicit non-default signing key required by policy.", "Step45 failed: blocked recommend error mismatch.");
    assert(recommendBlocked.body.signerPolicy?.requireExplicitKey === true, "Step45 failed: blocked recommend should expose requireExplicitKey=true.");
    assert(recommendBlocked.body.signerPolicy?.keySource === "env_shared_secret", "Step45 failed: blocked recommend keySource mismatch.");

    const recommendAllowed = await postJson(`http://127.0.0.1:${PORT_WITH_KEY}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(recommendAllowed.status === 200, "Step45 failed: recommend should succeed when explicit key is provided.");
    assert(recommendAllowed.body.signingMode === "prototype_hmac", "Step45 failed: signingMode mismatch.");
    assert(recommendAllowed.body.arb?.signature?.keySource === "env_shared_secret", "Step45 failed: signature.keySource mismatch.");

    const verifyAllowed = await postJson(`http://127.0.0.1:${PORT_WITH_KEY}/api/verify`, {
      transformedSnapshot: recommendAllowed.body.transformedSnapshot,
      recommendationSet: recommendAllowed.body.recommendationSet,
      arb: recommendAllowed.body.arb,
    });

    assert(verifyAllowed.status === 200, "Step45 failed: verify response should return 200.");
    assert(verifyAllowed.body.ok === true, "Step45 failed: verify should pass with explicit signing key.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY"), "Step45 failed: compose scaffold missing explicit key policy env.");
    assert(composeSource.includes("keySource"), "Step45 failed: compose scaffold missing keySource metadata.");

    const artifact = {
      schemaVersion: "step45-phala-minimal-explicit-key-policy-v1",
      recommendBlocked: recommendBlocked.body,
      recommendAllowed: recommendAllowed.body,
      verifyAllowed: verifyAllowed.body,
      process: {
        firstStdout: firstStdout.trim(),
        firstStderr: firstStderr.trim(),
        secondStdout: secondStdout.trim(),
        secondStderr: secondStderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype fails closed when explicit-key policy is enabled and no non-default signing key is provided, and it succeeds with signer metadata once an explicit key is configured.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 45 artifact: ${ARTIFACT_PATH}`);
    console.log(`Blocked default-key signing ok: ${recommendBlocked.status === 503}`);
    console.log(`Explicit-key signing ok: ${recommendAllowed.body.ok === true}`);
    console.log("Step 45 phala minimal explicit-key policy test: PASS");
  } finally {
    firstServer.kill("SIGTERM");
    secondServer.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 45 phala minimal explicit-key policy test failed.", error);
  process.exitCode = 1;
});
