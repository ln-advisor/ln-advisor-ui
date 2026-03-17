import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-attestation-policy.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8813;

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
  nodeAlias: "phala-phala-minimal-attestation-policy-node",
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-phala-minimal-attestation-policy-test",
      PROTOTYPE_ARB_SIGNING_KEY: "phala-minimal-attestation-policy-signing-key",
      PROTOTYPE_VERIFY_REQUIRE_ATTESTATION: "true",
      PROTOTYPE_VERIFY_MIN_EXECUTION_MODE: "tee_verified",
      PROTOTYPE_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "phala-minimal-attestation-policy-measurement",
      PROTOTYPE_ATTESTATION_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "phala-minimal-attestation-policy-measurement",
      PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING: "true",
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
    });

    const tamperedMeasurementArb = sortObjectKeysDeep(recommendResponse.body.arb);
    tamperedMeasurementArb.attestation.measurement = "wrong-measurement";
    const verifyWrongMeasurement = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: tamperedMeasurementArb,
    });

    const tamperedReportDataArb = sortObjectKeysDeep(recommendResponse.body.arb);
    tamperedReportDataArb.attestation.reportDataDigest = "00".repeat(32);
    const verifyWrongReportData = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: tamperedReportDataArb,
    });

    assert(recommendResponse.status === 200, "Phala Minimal Attestation Policy failed: recommend response should return 200.");
    assert(recommendResponse.body.arb?.attestation?.providerId === "phala-cloud", "Phala Minimal Attestation Policy failed: attestation providerId mismatch.");
    assert(recommendResponse.body.arb?.attestation?.measurement === "phala-minimal-attestation-policy-measurement", "Phala Minimal Attestation Policy failed: attestation measurement mismatch.");
    assert(verifyPass.body.ok === true, "Phala Minimal Attestation Policy failed: valid attestation policy verification should pass.");
    assert(verifyPass.body.attestationPolicy?.requireAttestation === true, "Phala Minimal Attestation Policy failed: attestation policy should require attestation.");
    assert(verifyWrongMeasurement.body.ok === false, "Phala Minimal Attestation Policy failed: wrong measurement should fail verification.");
    assert(verifyWrongMeasurement.body.errors.includes("attestation.measurement mismatch."), "Phala Minimal Attestation Policy failed: wrong measurement mismatch error missing.");
    assert(verifyWrongReportData.body.ok === false, "Phala Minimal Attestation Policy failed: wrong reportDataDigest should fail verification.");
    assert(verifyWrongReportData.body.errors.includes("attestation.reportDataDigest mismatch."), "Phala Minimal Attestation Policy failed: reportDataDigest mismatch error missing.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes("PROTOTYPE_VERIFY_REQUIRE_ATTESTATION"), "Phala Minimal Attestation Policy failed: compose scaffold missing attestation policy env.");
    assert(composeSource.includes("PROTOTYPE_ATTESTATION_MEASUREMENT"), "Phala Minimal Attestation Policy failed: compose scaffold missing attestation measurement env.");

    const artifact = {
      schemaVersion: "phala-minimal-attestation-policy-v1",
      recommendResponse: recommendResponse.body,
      verifyPass: verifyPass.body,
      verifyWrongMeasurement: verifyWrongMeasurement.body,
      verifyWrongReportData: verifyWrongReportData.body,
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype binds env-configured attestation evidence into the ARB and verification enforces execution, provider, measurement, and report-data policy checks.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Phala Minimal Attestation Policy artifact: ${ARTIFACT_PATH}`);
    console.log(`Attestation policy pass ok: ${verifyPass.body.ok === true}`);
    console.log(`Tampered attestation rejected: ${verifyWrongMeasurement.body.ok === false && verifyWrongReportData.body.ok === false}`);
    console.log("Phala Minimal Attestation Policy test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Phala Minimal Attestation Policy test failed.", error);
  process.exitCode = 1;
});


