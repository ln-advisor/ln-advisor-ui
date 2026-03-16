import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step52.phala-minimal-live-app-evidence-binding.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8816;

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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const sampleTelemetry = {
  nodeAlias: "phala-step52-node",
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
  ],
};

async function main() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(PORT),
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-step52-test",
      PROTOTYPE_ARB_SIGNING_KEY: "step52-signing-key",
      PROTOTYPE_VERIFY_REQUIRE_ATTESTATION: "true",
      PROTOTYPE_VERIFY_MIN_EXECUTION_MODE: "tee_verified",
      PROTOTYPE_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "step52-measurement",
      PROTOTYPE_ATTESTATION_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_ATTESTATION_QUOTE: "step52-quote",
      PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "step52-measurement",
      PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING: "true",
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true",
      PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await sleep(900);

    const recommend = await postJson(`http://127.0.0.1:${PORT}/api/recommend?full=true`, { telemetry: sampleTelemetry });
    const liveAppInfo = await getJson(`http://127.0.0.1:${PORT}/info?full=true`);
    const liveAppAttestation = await getJson(`http://127.0.0.1:${PORT}/attestation?full=true`);

    const verifyPass = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommend.body.transformedSnapshot,
      recommendationSet: recommend.body.recommendationSet,
      arb: recommend.body.arb,
      sourceReceipt: recommend.body.sourceReceipt,
      liveAppInfo: liveAppInfo.body,
      liveAppAttestation: liveAppAttestation.body,
    });

    const tamperedLiveAppAttestation = sortObjectKeysDeep(liveAppAttestation.body);
    tamperedLiveAppAttestation.report_data = "00".repeat(32);
    const verifyBadReportData = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommend.body.transformedSnapshot,
      recommendationSet: recommend.body.recommendationSet,
      arb: recommend.body.arb,
      sourceReceipt: recommend.body.sourceReceipt,
      liveAppInfo: liveAppInfo.body,
      liveAppAttestation: tamperedLiveAppAttestation,
    });

    const tamperedLiveAppInfo = sortObjectKeysDeep(liveAppInfo.body);
    tamperedLiveAppInfo.tcb_info.app_compose = JSON.stringify({ broken: true });
    const verifyBadCompose = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommend.body.transformedSnapshot,
      recommendationSet: recommend.body.recommendationSet,
      arb: recommend.body.arb,
      sourceReceipt: recommend.body.sourceReceipt,
      liveAppInfo: tamperedLiveAppInfo,
      liveAppAttestation: liveAppAttestation.body,
    });

    assert(recommend.status === 200, "Step52 failed: recommend should return 200.");
    assert(verifyPass.body.ok === true, "Step52 failed: valid live app evidence verification should pass.");
    assert(verifyPass.body.liveAppEvidencePolicy?.requireLiveAppEvidence === true, "Step52 failed: live app evidence policy should require evidence.");
    assert(verifyBadReportData.body.ok === false, "Step52 failed: bad live app report_data should fail verification.");
    assert(verifyBadReportData.body.errors.includes("liveAppAttestation.report_data mismatch."), "Step52 failed: report_data mismatch error missing.");
    assert(verifyBadCompose.body.ok === false, "Step52 failed: bad live app compose should fail verification.");
    assert(verifyBadCompose.body.errors.includes("liveAppAttestation.composeHash mismatch."), "Step52 failed: composeHash mismatch error missing.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes('PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE'), "Step52 failed: compose scaffold missing live app evidence policy env.");
    assert(composeSource.includes('liveAppAttestation'), "Step52 failed: compose scaffold missing live app evidence verification logic.");

    const artifact = {
      schemaVersion: "step52-phala-minimal-live-app-evidence-binding-v1",
      recommend: recommend.body,
      liveAppInfo: liveAppInfo.body,
      liveAppAttestation: liveAppAttestation.body,
      verifyPass: verifyPass.body,
      verifyBadReportData: verifyBadReportData.body,
      verifyBadCompose: verifyBadCompose.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype can compare caller-supplied live /info and /attestation evidence against the ARB and reject mismatched report-data or compose-hash evidence.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 52 artifact: ${ARTIFACT_PATH}`);
    console.log(`Live app evidence verification ok: ${verifyPass.body.ok === true}`);
    console.log(`Tampered live app evidence rejected: ${verifyBadReportData.body.ok === false && verifyBadCompose.body.ok === false}`);
    console.log("Step 52 phala minimal live app evidence binding test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 52 phala minimal live app evidence binding test failed.", error);
  process.exitCode = 1;
});
