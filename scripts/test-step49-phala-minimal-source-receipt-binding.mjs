import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step49.phala-minimal-source-receipt-binding.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8814;

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
  nodeAlias: "phala-step49-node",
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
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(PORT),
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step49-test",
      PROTOTYPE_ARB_SIGNING_KEY: "step49-signing-key",
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true",
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
    await sleep(900);

    const recommendResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });

    const verifyPass = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: recommendResponse.body.arb,
      sourceReceipt: recommendResponse.body.sourceReceipt,
    });

    const verifyMissingReceipt = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: recommendResponse.body.arb,
    });

    const tamperedSourceReceipt = sortObjectKeysDeep(recommendResponse.body.sourceReceipt);
    tamperedSourceReceipt.channelCount = 999;
    const verifyWrongReceipt = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: recommendResponse.body.arb,
      sourceReceipt: tamperedSourceReceipt,
    });

    assert(recommendResponse.status === 200, "Step49 failed: recommend response should return 200.");
    assert(typeof recommendResponse.body.arb?.sourceReceiptHash === "string", "Step49 failed: sourceReceiptHash should be present in the ARB.");
    assert(recommendResponse.body.sourceReceipt?.schemaVersion === "prototype-source-receipt-v1", "Step49 failed: sourceReceipt schemaVersion mismatch.");
    assert(verifyPass.body.ok === true, "Step49 failed: valid source receipt verification should pass.");
    assert(verifyPass.body.sourceReceiptPolicy?.requireSourceReceipt === true, "Step49 failed: source receipt policy should require a source receipt.");
    assert(verifyMissingReceipt.body.ok === false, "Step49 failed: missing source receipt should fail when policy requires it.");
    assert(verifyMissingReceipt.body.errors.includes("Source receipt is required by policy but missing."), "Step49 failed: missing source receipt error mismatch.");
    assert(verifyWrongReceipt.body.ok === false, "Step49 failed: tampered source receipt should fail.");
    assert(verifyWrongReceipt.body.errors.includes("sourceReceiptHash mismatch."), "Step49 failed: sourceReceiptHash mismatch error missing.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT"), "Step49 failed: compose scaffold missing source receipt policy env.");
    assert(composeSource.includes("buildSourceReceipt"), "Step49 failed: compose scaffold missing source receipt builder.");

    const artifact = {
      schemaVersion: "step49-phala-minimal-source-receipt-binding-v1",
      recommendResponse: recommendResponse.body,
      verifyPass: verifyPass.body,
      verifyMissingReceipt: verifyMissingReceipt.body,
      verifyWrongReceipt: verifyWrongReceipt.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype emits a source receipt and verification can require and bind that receipt to the ARB via sourceReceiptHash.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 49 artifact: ${ARTIFACT_PATH}`);
    console.log(`Source receipt verification ok: ${verifyPass.body.ok === true}`);
    console.log(`Missing or tampered receipts rejected: ${verifyMissingReceipt.body.ok === false && verifyWrongReceipt.body.ok === false}`);
    console.log("Step 49 phala minimal source receipt binding test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 49 phala minimal source receipt binding test failed.", error);
  process.exitCode = 1;
});
