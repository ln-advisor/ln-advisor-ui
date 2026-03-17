import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-arb.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8804;

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
  nodeAlias: "phala-arb-node",
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-phala-minimal-arb-test",
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

    const firstResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });
    const secondResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    assert(firstResponse.status === 200, "Phala Minimal Arb failed: first recommend response did not return 200.");
    assert(secondResponse.status === 200, "Phala Minimal Arb failed: second recommend response did not return 200.");

    const firstArb = firstResponse.body.arb;
    const secondArb = secondResponse.body.arb;

    assert(firstResponse.body.signingMode === "prototype_hmac", "Phala Minimal Arb failed: signingMode mismatch.");
    assert(firstArb?.arbVersion === "prototype-arb-v1", "Phala Minimal Arb failed: arbVersion mismatch.");
    assert(firstArb?.bindingMode === "sha256-digest", "Phala Minimal Arb failed: bindingMode mismatch.");
    assert(firstArb?.modelVersion === "prototype-fee-forward-v1", "Phala Minimal Arb failed: ARB modelVersion mismatch.");
    assert(firstArb?.privacyMode === "feature_only", "Phala Minimal Arb failed: ARB privacyMode mismatch.");
    assert(firstArb?.issuedAt === "2026-03-13T00:00:00Z", "Phala Minimal Arb failed: ARB issuedAt mismatch.");
    assert(firstArb?.verified === false, "Phala Minimal Arb failed: ARB verified flag should remain false.");
    assert(firstArb?.signature?.algorithm === "hmac-sha256", "Phala Minimal Arb failed: ARB signature.algorithm mismatch.");

    const expectedInputHash = sha256Hex(firstResponse.body.transformedSnapshot);
    const expectedOutputHash = sha256Hex(firstResponse.body.recommendationSet);
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

    assert(firstArb?.inputHash === expectedInputHash, "Phala Minimal Arb failed: inputHash mismatch.");
    assert(firstArb?.outputHash === expectedOutputHash, "Phala Minimal Arb failed: outputHash mismatch.");
    assert(firstArb?.digest === expectedDigest, "Phala Minimal Arb failed: digest mismatch.");
    assert(firstArb?.digest === secondArb?.digest, "Phala Minimal Arb failed: digest is not deterministic across identical runs.");
    assert(firstArb?.inputHash === secondArb?.inputHash, "Phala Minimal Arb failed: inputHash is not deterministic across identical runs.");
    assert(firstArb?.outputHash === secondArb?.outputHash, "Phala Minimal Arb failed: outputHash is not deterministic across identical runs.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("prototype_hmac"), "Phala Minimal Arb failed: compose scaffold missing prototype_hmac signing mode.");
    assert(composeSource.includes("sha256-digest"), "Phala Minimal Arb failed: compose scaffold missing sha256-digest binding mode.");

    const artifact = {
      schemaVersion: "phala-minimal-arb-v1",
      sampleTelemetry,
      recommendResponse: firstResponse.body,
      secondArb,
      expected: {
        inputHash: expectedInputHash,
        outputHash: expectedOutputHash,
        digest: expectedDigest,
      },
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype recommend endpoint returns a deterministic payload-bound prototype ARB whose inputHash, outputHash, and digest are derived from the real transformed snapshot and recommendation set.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Phala Minimal Arb artifact: ${ARTIFACT_PATH}`);
    console.log(`Prototype ARB digest ok: ${firstArb?.digest === expectedDigest}`);
    console.log(`Deterministic ARB repeat ok: ${firstArb?.digest === secondArb?.digest}`);
    console.log("Phala Minimal Arb test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Phala Minimal Arb test failed.", error);
  process.exitCode = 1;
});


