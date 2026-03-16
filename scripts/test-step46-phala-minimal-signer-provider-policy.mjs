import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step46.phala-minimal-signer-provider-policy.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT_ALLOWED = 8809;
const PORT_REJECTED = 8810;

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
  nodeAlias: "phala-signer-policy-node",
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
      PROTOTYPE_SERVICE_NAME: `ln-advisor-phala-minimal-step46-${port}`,
      PROTOTYPE_ARB_SIGNING_KEY: "step46-signing-key",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  const allowedServer = startServer(PORT_ALLOWED, {
    PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-env-signer-v1",
    PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID: "prototype-env-signer-v1",
  });
  let allowedStdout = "";
  let allowedStderr = "";
  allowedServer.stdout.on("data", (chunk) => {
    allowedStdout += chunk.toString();
  });
  allowedServer.stderr.on("data", (chunk) => {
    allowedStderr += chunk.toString();
  });

  const rejectedServer = startServer(PORT_REJECTED, {
    PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-alt-signer-v1",
    PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID: "prototype-env-signer-v1",
  });
  let rejectedStdout = "";
  let rejectedStderr = "";
  rejectedServer.stdout.on("data", (chunk) => {
    rejectedStdout += chunk.toString();
  });
  rejectedServer.stderr.on("data", (chunk) => {
    rejectedStderr += chunk.toString();
  });

  try {
    await sleep(900);

    const allowedRecommend = await postJson(`http://127.0.0.1:${PORT_ALLOWED}/api/recommend`, {
      telemetry: sampleTelemetry,
    });
    const rejectedRecommend = await postJson(`http://127.0.0.1:${PORT_REJECTED}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(allowedRecommend.status === 200, "Step46 failed: allowed provider recommend should return 200.");
    assert(rejectedRecommend.status === 200, "Step46 failed: rejected provider recommend should still return 200 before verification.");
    assert(allowedRecommend.body.arb?.signature?.signerProviderId === "prototype-env-signer-v1", "Step46 failed: allowed provider id mismatch.");
    assert(rejectedRecommend.body.arb?.signature?.signerProviderId === "prototype-alt-signer-v1", "Step46 failed: rejected provider id mismatch.");

    const allowedVerify = await postJson(`http://127.0.0.1:${PORT_ALLOWED}/api/verify`, {
      transformedSnapshot: allowedRecommend.body.transformedSnapshot,
      recommendationSet: allowedRecommend.body.recommendationSet,
      arb: allowedRecommend.body.arb,
    });

    const rejectedVerify = await postJson(`http://127.0.0.1:${PORT_REJECTED}/api/verify`, {
      transformedSnapshot: rejectedRecommend.body.transformedSnapshot,
      recommendationSet: rejectedRecommend.body.recommendationSet,
      arb: rejectedRecommend.body.arb,
    });

    assert(allowedVerify.body.ok === true, "Step46 failed: allowed provider verification should pass.");
    assert(rejectedVerify.body.ok === false, "Step46 failed: rejected provider verification should fail.");
    assert(rejectedVerify.body.errors.includes("signature.signerProviderId mismatch."), "Step46 failed: rejected provider should trigger signerProviderId mismatch.");
    assert(rejectedVerify.body.signerPolicy?.allowedSignerProviderId === "prototype-env-signer-v1", "Step46 failed: signer policy allowed provider mismatch.");
    assert(rejectedVerify.body.signerPolicy?.expectedSignerProviderType === "env_hmac", "Step46 failed: signer policy provider type mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("PROTOTYPE_SIGNER_PROVIDER_ID"), "Step46 failed: compose scaffold missing signer provider id env.");
    assert(composeSource.includes("PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID"), "Step46 failed: compose scaffold missing allowed signer provider env.");

    const artifact = {
      schemaVersion: "step46-phala-minimal-signer-provider-policy-v1",
      allowedRecommend: allowedRecommend.body,
      allowedVerify: allowedVerify.body,
      rejectedRecommend: rejectedRecommend.body,
      rejectedVerify: rejectedVerify.body,
      process: {
        allowedStdout: allowedStdout.trim(),
        allowedStderr: allowedStderr.trim(),
        rejectedStdout: rejectedStdout.trim(),
        rejectedStderr: rejectedStderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype can advertise signer provider metadata in the ARB and enforce an allowed signer provider id during verification.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 46 artifact: ${ARTIFACT_PATH}`);
    console.log(`Allowed signer provider ok: ${allowedVerify.body.ok === true}`);
    console.log(`Rejected signer provider blocked: ${rejectedVerify.body.ok === false}`);
    console.log("Step 46 phala minimal signer provider policy test: PASS");
  } finally {
    allowedServer.kill("SIGTERM");
    rejectedServer.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 46 phala minimal signer provider policy test failed.", error);
  process.exitCode = 1;
});
