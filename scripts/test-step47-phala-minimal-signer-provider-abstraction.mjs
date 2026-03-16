import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step47.phala-minimal-signer-provider-abstraction.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT_ENV = 8811;
const PORT_STUB = 8812;

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

function startServer(port, extraEnv = {}) {
  return spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      PROTOTYPE_SERVICE_NAME: `ln-advisor-phala-minimal-step47-${port}`,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const sampleTelemetry = {
  nodeAlias: "phala-step47-node",
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

async function main() {
  const envServer = startServer(PORT_ENV, {
    PROTOTYPE_SIGNER_PROVIDER_TYPE: "env_hmac",
    PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-env-signer-v2",
    PROTOTYPE_ARB_SIGNING_KEY: "step47-env-key",
    PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID: "prototype-env-signer-v2",
    PROTOTYPE_ARB_VERIFY_EXPECTED_SIGNER_PROVIDER_TYPE: "env_hmac",
  });
  let envStdout = "";
  let envStderr = "";
  envServer.stdout.on("data", (chunk) => {
    envStdout += chunk.toString();
  });
  envServer.stderr.on("data", (chunk) => {
    envStderr += chunk.toString();
  });

  const stubServer = startServer(PORT_STUB, {
    PROTOTYPE_SIGNER_PROVIDER_TYPE: "phala_kms_stub",
    PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-kms-stub-v1",
    PROTOTYPE_SIGNER_PROVIDER_UNAVAILABLE_REASON: "Step47 stub provider unavailable.",
  });
  let stubStdout = "";
  let stubStderr = "";
  stubServer.stdout.on("data", (chunk) => {
    stubStdout += chunk.toString();
  });
  stubServer.stderr.on("data", (chunk) => {
    stubStderr += chunk.toString();
  });

  try {
    await sleep(900);

    const envRecommend = await postJson(`http://127.0.0.1:${PORT_ENV}/api/recommend`, {
      telemetry: sampleTelemetry,
    });
    const envVerify = await postJson(`http://127.0.0.1:${PORT_ENV}/api/verify`, {
      transformedSnapshot: envRecommend.body.transformedSnapshot,
      recommendationSet: envRecommend.body.recommendationSet,
      arb: envRecommend.body.arb,
    });

    const stubRecommend = await postJson(`http://127.0.0.1:${PORT_STUB}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(envRecommend.status === 200, "Step47 failed: env_hmac provider recommend should return 200.");
    assert(envRecommend.body.arb?.signature?.signerProviderId === "prototype-env-signer-v2", "Step47 failed: env_hmac signerProviderId mismatch.");
    assert(envRecommend.body.arb?.signature?.signerProviderType === "env_hmac", "Step47 failed: env_hmac signerProviderType mismatch.");
    assert(envVerify.body.ok === true, "Step47 failed: env_hmac provider verification should pass.");

    assert(stubRecommend.status === 503, "Step47 failed: stub provider recommend should fail closed with 503.");
    assert(stubRecommend.body.mode === "prototype_signer_provider", "Step47 failed: stub provider mode mismatch.");
    assert(stubRecommend.body.error === "Step47 stub provider unavailable.", "Step47 failed: stub provider error mismatch.");
    assert(stubRecommend.body.signerPolicy?.signerProviderType === "phala_kms_stub", "Step47 failed: stub provider signerPolicy type mismatch.");
    assert(stubRecommend.body.signerPolicy?.signerProviderId === "prototype-kms-stub-v1", "Step47 failed: stub provider signerPolicy id mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("PROTOTYPE_SIGNER_PROVIDER_TYPE"), "Step47 failed: compose scaffold missing signer provider type env.");
    assert(composeSource.includes("createSignerProviderRuntime"), "Step47 failed: compose scaffold missing signer provider abstraction runtime.");

    const artifact = {
      schemaVersion: "step47-phala-minimal-signer-provider-abstraction-v1",
      envRecommend: envRecommend.body,
      envVerify: envVerify.body,
      stubRecommend: stubRecommend.body,
      process: {
        envStdout: envStdout.trim(),
        envStderr: envStderr.trim(),
        stubStdout: stubStdout.trim(),
        stubStderr: stubStderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype signs and verifies through a signer provider runtime and fails closed when a non-implemented provider type is selected.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 47 artifact: ${ARTIFACT_PATH}`);
    console.log(`env_hmac provider ok: ${envVerify.body.ok === true}`);
    console.log(`stub provider blocked: ${stubRecommend.status === 503}`);
    console.log("Step 47 phala minimal signer provider abstraction test: PASS");
  } finally {
    envServer.kill("SIGTERM");
    stubServer.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 47 phala minimal signer provider abstraction test failed.", error);
  process.exitCode = 1;
});
