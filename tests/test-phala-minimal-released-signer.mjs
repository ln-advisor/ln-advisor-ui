import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT_DIR = process.cwd();
const ARTIFACT_PATH = path.resolve(ROOT_DIR, "artifacts", "phala-minimal-released-signer.json");
const SERVER_PATH = path.resolve(ROOT_DIR, "deploy", "phala-minimal-prototype", "server.mjs");
const SYNC_SCRIPT_PATH = path.resolve(ROOT_DIR, "scripts", "sync-phala-minimal-inline.mjs");
const TEMPLATE_COMPOSE_PATH = path.resolve(ROOT_DIR, "deploy", "phala-minimal-prototype", "docker-compose.yml");
const RENDERED_COMPOSE_PATH = path.resolve(ROOT_DIR, "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");

const APP_PORT = 8823;
const BAD_APP_PORT = 8824;
const RELEASED_KEY_ID = "arb-signer-phala-minimal-released-signer";
const RELEASED_KEY_PROVIDER_ID = "prototype-key-release-provider-phala-minimal-released-signer";
const RELEASED_SIGNER_PROVIDER_ID = "prototype-released-signer-phala-minimal-released-signer";
const RELEASED_KEY_MATERIAL = "phala-minimal-released-signer-released-signing-key";
const GOOD_MEASUREMENT = "phala-minimal-released-signer-measurement";
const BAD_MEASUREMENT = "phala-minimal-released-signer-measurement-mismatch";

const sampleTelemetry = {
  nodeAlias: "phala-phala-minimal-released-signer-node",
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

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortObjectKeysDeep = (value) => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(value[key]);
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

const parseEnvFile = (text) => {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return env;
};

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return { status: response.status, body: await response.json() };
}

async function runSync(envFilePath) {
  const child = spawn(process.execPath, [SYNC_SCRIPT_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PHALA_MINIMAL_ENV_FILE: path.relative(ROOT_DIR, envFilePath).replace(/\\/g, "/"),
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

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert(exitCode === 0, `Phala Minimal Released Signer failed: sync script exited with ${exitCode}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function startServer(port, env) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
      API_PORT: String(port),
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

  await sleep(900);

  return {
    child,
    getOutput: () => ({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }),
  };
}

async function main() {
  const tempDir = path.resolve(ROOT_DIR, "artifacts", "phala-minimal-released-signer-temp");
  await mkdir(tempDir, { recursive: true });
  const envFile = path.join(tempDir, "minimal.env");

  const envContents = [
    "PHALA_CVM_NAME=ln-advisor-phala-minimal-phala-minimal-released-signer",
    "PROTOTYPE_SERVICE_NAME=ln-advisor-phala-minimal-phala-minimal-released-signer",
    "PROTOTYPE_SIGNER_PROVIDER_TYPE=released_keyring",
    `PROTOTYPE_SIGNER_PROVIDER_ID=${RELEASED_SIGNER_PROVIDER_ID}`,
    `PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID=${RELEASED_SIGNER_PROVIDER_ID}`,
    "PROTOTYPE_ARB_VERIFY_EXPECTED_SIGNER_PROVIDER_TYPE=released_keyring",
    "PROTOTYPE_ATTESTATION_INCLUDE=true",
    "PROTOTYPE_ATTESTATION_SOURCE=prototype_env",
    "PROTOTYPE_ATTESTATION_PROVIDER_ID=phala-cloud",
    "PROTOTYPE_ATTESTATION_EXECUTION_MODE=tee_verified",
    "PROTOTYPE_ATTESTATION_QUOTE_FORMAT=tdx_quote",
    `PROTOTYPE_ATTESTATION_MEASUREMENT=${GOOD_MEASUREMENT}`,
    "PROTOTYPE_ATTESTATION_QUOTE=phala-minimal-released-signer-phala-quote",
    "PROTOTYPE_ATTESTATION_NONCE=phala-minimal-released-signer-attestation-nonce",
    "PROTOTYPE_ATTESTATION_ISSUED_AT=2026-03-16T12:00:00Z",
    `PROTOTYPE_RELEASED_SIGNER_KEY_ID=${RELEASED_KEY_ID}`,
    `PROTOTYPE_RELEASED_SIGNER_KEY_PROVIDER_ID=${RELEASED_KEY_PROVIDER_ID}`,
    `PROTOTYPE_RELEASED_SIGNER_KEYRING_JSON={\"${RELEASED_KEY_ID}\":\"${RELEASED_KEY_MATERIAL}\"}`,
    "PROTOTYPE_RELEASED_SIGNER_REQUIRE_ATTESTATION=true",
    "PROTOTYPE_RELEASED_SIGNER_MIN_EXECUTION_MODE=tee_verified",
    "PROTOTYPE_RELEASED_SIGNER_ALLOWED_PROVIDER_IDS=phala-cloud",
    `PROTOTYPE_RELEASED_SIGNER_ALLOWED_MEASUREMENTS=${GOOD_MEASUREMENT}`,
    "PROTOTYPE_RELEASED_SIGNER_ALLOWED_QUOTE_FORMATS=tdx_quote",
    "PROTOTYPE_VERIFY_REQUIRE_ATTESTATION=true",
    "PROTOTYPE_VERIFY_MIN_EXECUTION_MODE=tee_verified",
    "PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID=phala-cloud",
    `PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT=${GOOD_MEASUREMENT}`,
    "PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT=tdx_quote",
  ].join("\n") + "\n";
  await writeFile(envFile, envContents, "utf8");

  const syncOutput = await runSync(envFile);
  const parsedEnv = parseEnvFile(await readFile(envFile, "utf8"));
  const goodServer = await startServer(APP_PORT, parsedEnv);
  const badServer = await startServer(BAD_APP_PORT, {
    ...parsedEnv,
    PROTOTYPE_ATTESTATION_MEASUREMENT: BAD_MEASUREMENT,
  });

  try {
    const health = await getJson(`http://127.0.0.1:${APP_PORT}/health`);
    const recommend = await postJson(`http://127.0.0.1:${APP_PORT}/api/recommend?full=true`, {
      telemetry: sampleTelemetry,
    });
    const verify = await postJson(`http://127.0.0.1:${APP_PORT}/api/verify`, {
      transformedSnapshot: recommend.body.transformedSnapshot,
      recommendationSet: recommend.body.recommendationSet,
      arb: recommend.body.arb,
      sourceReceipt: recommend.body.sourceReceipt,
    });
    const deniedRecommend = await postJson(`http://127.0.0.1:${BAD_APP_PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(health.status === 200, "Phala Minimal Released Signer failed: /health should return 200.");
    assert(
      health.body?.signerProvider?.providerType === "released_keyring",
      "Phala Minimal Released Signer failed: /health signerProvider.providerType mismatch."
    );
    assert(
      health.body?.signerProvider?.signingMode === "released_signer",
      "Phala Minimal Released Signer failed: /health signingMode should report released_signer."
    );
    assert(
      health.body?.signerProvider?.keyProviderId === RELEASED_KEY_PROVIDER_ID,
      "Phala Minimal Released Signer failed: /health keyProviderId mismatch."
    );
    assert(
      health.body?.signerProvider?.releasedSignerPolicy?.keyId === RELEASED_KEY_ID,
      "Phala Minimal Released Signer failed: /health released signer policy keyId mismatch."
    );

    assert(recommend.status === 200, "Phala Minimal Released Signer failed: released signer recommend should return 200.");
    assert(recommend.body?.signingMode === "released_signer", "Phala Minimal Released Signer failed: signingMode should be released_signer.");
    assert(
      recommend.body?.arb?.signature?.signerProviderId === RELEASED_SIGNER_PROVIDER_ID,
      "Phala Minimal Released Signer failed: signature signerProviderId mismatch."
    );
    assert(
      recommend.body?.arb?.signature?.signerProviderType === "released_keyring",
      "Phala Minimal Released Signer failed: signature signerProviderType mismatch."
    );
    assert(
      recommend.body?.arb?.signature?.keyId === RELEASED_KEY_ID,
      "Phala Minimal Released Signer failed: signature keyId mismatch."
    );
    assert(
      recommend.body?.arb?.signature?.keySource === RELEASED_KEY_PROVIDER_ID,
      "Phala Minimal Released Signer failed: signature keySource should come from released signer key provider."
    );
    assert(
      recommend.body?.arb?.attestation?.measurement === GOOD_MEASUREMENT,
      "Phala Minimal Released Signer failed: attestation measurement mismatch."
    );
    assert(verify.body?.ok === true, "Phala Minimal Released Signer failed: released signer verification should pass.");
    assert(
      verify.body?.signerPolicy?.signingMode === "released_signer",
      "Phala Minimal Released Signer failed: verify signerPolicy signingMode mismatch."
    );
    assert(
      verify.body?.signerPolicy?.releasedSignerPolicy?.keyId === RELEASED_KEY_ID,
      "Phala Minimal Released Signer failed: verify signerPolicy missing released signer policy."
    );

    assert(
      deniedRecommend.status === 503,
      "Phala Minimal Released Signer failed: released signer should fail closed when attestation policy denies key release."
    );
    assert(
      String(deniedRecommend.body?.error || "").includes("Released signer key release denied:"),
      "Phala Minimal Released Signer failed: denied recommend should report key release denial."
    );
    assert(
      String(deniedRecommend.body?.error || "").includes("Attestation measurement is not allowed for released signer key release."),
      "Phala Minimal Released Signer failed: denied recommend should report the attestation measurement policy violation."
    );

    const templateCompose = await readFile(TEMPLATE_COMPOSE_PATH, "utf8");
    const renderedCompose = await readFile(RENDERED_COMPOSE_PATH, "utf8");
    assert(
      templateCompose.includes("PROTOTYPE_RELEASED_SIGNER_KEY_ID"),
      "Phala Minimal Released Signer failed: compose scaffold missing PROTOTYPE_RELEASED_SIGNER_KEY_ID."
    );
    assert(
      templateCompose.includes("PROTOTYPE_RELEASED_SIGNER_KEYRING_JSON"),
      "Phala Minimal Released Signer failed: compose scaffold missing PROTOTYPE_RELEASED_SIGNER_KEYRING_JSON."
    );
    assert(
      templateCompose.includes("PROTOTYPE_RELEASED_SIGNER_ALLOWED_MEASUREMENTS"),
      "Phala Minimal Released Signer failed: compose scaffold missing PROTOTYPE_RELEASED_SIGNER_ALLOWED_MEASUREMENTS."
    );
    assert(
      renderedCompose.includes(`PROTOTYPE_SIGNER_PROVIDER_TYPE: "released_keyring"`),
      "Phala Minimal Released Signer failed: rendered compose missing released_keyring provider type."
    );
    assert(
      renderedCompose.includes(`PROTOTYPE_RELEASED_SIGNER_KEY_PROVIDER_ID: "${RELEASED_KEY_PROVIDER_ID}"`),
      "Phala Minimal Released Signer failed: rendered compose missing released signer key provider id."
    );

    const artifact = {
      schemaVersion: "phala-minimal-released-signer-v1",
      health: health.body,
      recommend: recommend.body,
      verify: verify.body,
      deniedRecommend: deniedRecommend.body,
      syncProcess: syncOutput,
      goodServer: goodServer.getOutput(),
      badServer: badServer.getOutput(),
      doneCondition:
        "The minimal Phala prototype can sign through a released keyring provider gated by attestation policy, expose that signer policy in health/verify, and fail closed when the runtime attestation does not satisfy the configured key-release policy.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Phala Minimal Released Signer artifact: ${ARTIFACT_PATH}`);
    console.log(`Released signer verify ok: ${verify.body?.ok === true}`);
    console.log(`Measurement mismatch blocked: ${deniedRecommend.status === 503}`);
    console.log("Phala Minimal Released Signer test: PASS");
  } finally {
    goodServer.child.kill("SIGTERM");
    badServer.child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Phala Minimal Released Signer test failed.", error);
  process.exitCode = 1;
});


