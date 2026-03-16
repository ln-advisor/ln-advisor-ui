import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step44.phala-minimal-hmac-signature.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8806;
const SIGNING_KEY = "step44-test-signing-key";

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
const stableStringify = (value) => JSON.stringify(sortObjectKeysDeep(value));
const sha256Hex = (value) => crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
const hmacSha256Hex = (value, key) =>
  crypto.createHmac("sha256", key).update(typeof value === "string" ? value : stableStringify(value)).digest("hex");

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
  nodeAlias: "phala-hmac-node",
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step44-test",
      PROTOTYPE_ARB_SIGNING_KEY: SIGNING_KEY,
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

    assert(recommendResponse.status === 200, "Step44 failed: recommend response did not return 200.");

    const arb = recommendResponse.body.arb;

    assert(recommendResponse.body.signingMode === "prototype_hmac", "Step44 failed: signingMode mismatch.");
    assert(arb?.signature?.algorithm === "hmac-sha256", "Step44 failed: signature.algorithm mismatch.");
    assert(arb?.signature?.keyId === "prototype-dev-hmac-v1", "Step44 failed: signature.keyId mismatch.");

    const expectedInputHash = sha256Hex(recommendResponse.body.transformedSnapshot);
    const expectedOutputHash = sha256Hex(recommendResponse.body.recommendationSet);
    const expectedDigest = sha256Hex({
      arbVersion: "prototype-arb-v1",
      provider: "phala-minimal-prototype",
      modelVersion: "prototype-fee-forward-v1",
      privacyMode: "feature_only",
      bindingMode: "sha256-digest",
      issuedAt: "2026-03-13T00:00:00Z",
      inputHash: expectedInputHash,
      outputHash: expectedOutputHash,
    });
    const expectedSignature = hmacSha256Hex(expectedDigest, SIGNING_KEY);

    assert(arb?.inputHash === expectedInputHash, "Step44 failed: inputHash mismatch.");
    assert(arb?.outputHash === expectedOutputHash, "Step44 failed: outputHash mismatch.");
    assert(arb?.digest === expectedDigest, "Step44 failed: digest mismatch.");
    assert(arb?.signature?.value === expectedSignature, "Step44 failed: signature value mismatch.");

    const verifyPass = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb,
    });

    const tamperedArb = sortObjectKeysDeep(arb);
    tamperedArb.signature.value = "0000000000000000000000000000000000000000000000000000000000000000";

    const verifyFail = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: tamperedArb,
    });

    assert(verifyPass.body.ok === true, "Step44 failed: valid HMAC verification should pass.");
    assert(verifyFail.body.ok === false, "Step44 failed: tampered signature should fail.");
    assert(verifyFail.body.errors.includes("signature mismatch."), "Step44 failed: tampered signature should trigger signature mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("prototype_hmac"), "Step44 failed: compose scaffold missing prototype_hmac signing mode.");
    assert(composeSource.includes("hmac-sha256"), "Step44 failed: compose scaffold missing hmac-sha256 signature logic.");

    const artifact = {
      schemaVersion: "step44-phala-minimal-hmac-signature-v1",
      recommendResponse: recommendResponse.body,
      verifyPass: verifyPass.body,
      verifyFail: verifyFail.body,
      expected: {
        inputHash: expectedInputHash,
        outputHash: expectedOutputHash,
        digest: expectedDigest,
        signature: expectedSignature,
      },
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype signs the payload-bound ARB with HMAC and the verify endpoint rejects bundles with tampered signatures.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 44 artifact: ${ARTIFACT_PATH}`);
    console.log(`Prototype HMAC signature ok: ${arb?.signature?.value === expectedSignature}`);
    console.log(`Tampered signature rejected: ${verifyFail.body.ok === false}`);
    console.log("Step 44 phala minimal HMAC signature test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 44 phala minimal HMAC signature test failed.", error);
  process.exitCode = 1;
});
