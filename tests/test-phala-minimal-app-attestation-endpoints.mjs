import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-app-attestation-endpoints.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const PORT = 8815;
const TEST_QUOTE = "phala-minimal-app-attestation-endpoints-quote-0123456789abcdef0123456789abcdef0123456789abcdef";

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
const sha256TextHex = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
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
  nodeAlias: "phala-phala-minimal-app-attestation-endpoints-node",
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
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-phala-minimal-app-attestation-endpoints-test",
      PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-env-signer-phala-minimal-app-attestation-endpoints",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "phala-minimal-app-attestation-endpoints-measurement",
      PROTOTYPE_ATTESTATION_QUOTE: TEST_QUOTE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await sleep(900);

    const health = await getJson(`http://127.0.0.1:${PORT}/health`);
    const compactRecommend = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, { telemetry: sampleTelemetry });
    const compactInfo = await getJson(`http://127.0.0.1:${PORT}/info`);
    const compactAttestation = await getJson(`http://127.0.0.1:${PORT}/attestation`);
    const recommend = await postJson(`http://127.0.0.1:${PORT}/api/recommend?full=true`, { telemetry: sampleTelemetry });
    const info = await getJson(`http://127.0.0.1:${PORT}/info?full=true`);
    const attestation = await getJson(`http://127.0.0.1:${PORT}/attestation?full=true`);

    const appCompose = info.body?.tcb_info?.app_compose;
    const composeHash = sha256TextHex(appCompose);
    const eventDigest = attestation.body?.event_log?.[0]?.digest;

    assert(health.body.mode === "minimal_props_service", "Phala Minimal App Attestation Endpoints failed: health mode mismatch.");
    assert(compactRecommend.status === 200, "Phala Minimal App Attestation Endpoints failed: compact /api/recommend should return 200.");
    assert(compactInfo.status === 200, "Phala Minimal App Attestation Endpoints failed: compact /info should return 200.");
    assert(compactAttestation.status === 200, "Phala Minimal App Attestation Endpoints failed: compact /attestation should return 200.");
    assert(info.status === 200, "Phala Minimal App Attestation Endpoints failed: /info should return 200.");
    assert(attestation.status === 200, "Phala Minimal App Attestation Endpoints failed: /attestation should return 200.");
    assert(typeof appCompose === "string" && appCompose.length > 0, "Phala Minimal App Attestation Endpoints failed: app_compose missing.");
    assert(
      compactInfo.body?.tcb_info?.app_compose === undefined,
      "Phala Minimal App Attestation Endpoints failed: compact /info should omit full app_compose."
    );
    assert(
      typeof compactInfo.body?.tcb_info?.app_compose_preview === "string" &&
        compactInfo.body.tcb_info.app_compose_preview.includes("..."),
      "Phala Minimal App Attestation Endpoints failed: compact /info should expose app_compose_preview."
    );
    assert(
      compactInfo.body?.tcb_info?.app_compose_length === appCompose.length,
      "Phala Minimal App Attestation Endpoints failed: compact /info app_compose_length mismatch."
    );
    assert(
      compactInfo.body?.tcb_info?.compose_hash === composeHash,
      "Phala Minimal App Attestation Endpoints failed: compact /info compose_hash mismatch."
    );
    assert(attestation.body.quote === TEST_QUOTE, "Phala Minimal App Attestation Endpoints failed: live attestation quote mismatch.");
    assert(
      compactAttestation.body?.quote === undefined,
      "Phala Minimal App Attestation Endpoints failed: compact /attestation should omit full quote."
    );
    assert(
      typeof compactAttestation.body?.quote_preview === "string" &&
        compactAttestation.body.quote_preview.includes("..."),
      "Phala Minimal App Attestation Endpoints failed: compact /attestation should expose quote_preview."
    );
    assert(
      compactAttestation.body?.quote_length === TEST_QUOTE.length,
      "Phala Minimal App Attestation Endpoints failed: compact /attestation quote_length mismatch."
    );
    assert(
      compactRecommend.body?.arb?.attestation?.quote === undefined,
      "Phala Minimal App Attestation Endpoints failed: compact /api/recommend should omit full ARB quote."
    );
    assert(
      typeof compactRecommend.body?.arb?.attestation?.quote_preview === "string" &&
        compactRecommend.body.arb.attestation.quote_preview.includes("..."),
      "Phala Minimal App Attestation Endpoints failed: compact /api/recommend should expose quote_preview."
    );
    assert(attestation.body.report_data === recommend.body.arb.digest, "Phala Minimal App Attestation Endpoints failed: live attestation report_data should match latest digest.");
    assert(eventDigest === composeHash, "Phala Minimal App Attestation Endpoints failed: event log compose hash mismatch.");
    assert(info.body.signerProvider?.providerId === "prototype-env-signer-phala-minimal-app-attestation-endpoints", "Phala Minimal App Attestation Endpoints failed: /info signerProviderId mismatch.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    assert(composeSource.includes('url.pathname === "/info"'), "Phala Minimal App Attestation Endpoints failed: compose scaffold missing /info route.");
    assert(composeSource.includes('url.pathname === "/attestation"'), "Phala Minimal App Attestation Endpoints failed: compose scaffold missing /attestation route.");

    const artifact = {
      schemaVersion: "phala-minimal-app-attestation-endpoints-v1",
      health: health.body,
      compactRecommend: compactRecommend.body,
      compactInfo: compactInfo.body,
      compactAttestation: compactAttestation.body,
      recommend: recommend.body,
      info: info.body,
      attestation: attestation.body,
      expected: {
        composeHash,
      },
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "The minimal Phala prototype exposes /info and /attestation endpoints whose compose hash and report_data can be compared against a generated ARB.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Phala Minimal App Attestation Endpoints artifact: ${ARTIFACT_PATH}`);
    console.log(`App attestation endpoints ok: ${eventDigest === composeHash && attestation.body.report_data === recommend.body.arb.digest}`);
    console.log("Phala Minimal App Attestation Endpoints test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Phala Minimal App Attestation Endpoints test failed.", error);
  process.exitCode = 1;
});


