import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-cloud-app-verification.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const SYNC_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "sync-phala-minimal-inline.mjs");
const TEMPLATE_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const RENDERED_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");

const GOOD_PORT = 8817;
const BAD_PORT = 8818;
const CLOUD_PORT = 8921;
const CLOUD_VERSION = "2026-03-14-phala-minimal-cloud-app-verification";
const CLOUD_API_KEY = "phala-minimal-cloud-app-verification-cloud-api-key";

const sampleTelemetry = {
  nodeAlias: "phala-phala-minimal-cloud-app-verification-node",
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

const collectJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? JSON.parse(text) : {};
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

async function runSyncWithRenderValues() {
  const child = spawn(process.execPath, [SYNC_SCRIPT_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "true",
      PHALA_CLOUD_API_BASE_URL: `http://127.0.0.1:${CLOUD_PORT}`,
      PHALA_API_VERSION: CLOUD_VERSION,
      PHALA_CLOUD_API_KEY: CLOUD_API_KEY,
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
  assert(exitCode === 0, "Phala Minimal Cloud App Verification failed: sync script did not exit cleanly.");
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function startPrototypeServer(port, attestationQuote) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      PROTOTYPE_SERVICE_NAME: `ln-advisor-phala-minimal-phala-minimal-cloud-app-verification-${port}`,
      PROTOTYPE_ARB_SIGNING_KEY: "phala-minimal-cloud-app-verification-signing-key",
      PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-env-signer-phala-minimal-cloud-app-verification",
      PROTOTYPE_VERIFY_REQUIRE_ATTESTATION: "true",
      PROTOTYPE_VERIFY_MIN_EXECUTION_MODE: "tee_verified",
      PROTOTYPE_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "phala-minimal-cloud-app-verification-measurement",
      PROTOTYPE_ATTESTATION_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_ATTESTATION_QUOTE: attestationQuote,
      PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "phala-minimal-cloud-app-verification-measurement",
      PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING: "true",
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true",
      PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE: "true",
      PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "true",
      PHALA_CLOUD_API_BASE_URL: `http://127.0.0.1:${CLOUD_PORT}`,
      PHALA_API_VERSION: CLOUD_VERSION,
      PHALA_CLOUD_API_KEY: CLOUD_API_KEY,
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
  const cloudCalls = [];
  const fakeCloudServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/attestations/verify") {
      const body = await collectJsonBody(req);
      cloudCalls.push({
        path: req.url,
        headers: req.headers,
        body,
      });

      const quoteHex = typeof body?.hex === "string" ? body.hex : "";
      const quoteVerified = quoteHex === "phala-minimal-cloud-app-verification-quote";
      const payload = {
        success: true,
        quote: {
          verified: quoteVerified,
          hex: quoteHex,
        },
      };

      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(payload)}\n`);
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end('{"ok":false}\n');
  });

  await new Promise((resolve) => fakeCloudServer.listen(CLOUD_PORT, "127.0.0.1", resolve));

  const syncProcess = await runSyncWithRenderValues();
  const goodServer = await startPrototypeServer(GOOD_PORT, "phala-minimal-cloud-app-verification-quote");
  const badServer = await startPrototypeServer(BAD_PORT, "phala-minimal-cloud-app-verification-quote-unverified");

  try {
    const goodRecommend = await postJson(`http://127.0.0.1:${GOOD_PORT}/api/recommend?full=true`, { telemetry: sampleTelemetry });
    const goodInfo = await getJson(`http://127.0.0.1:${GOOD_PORT}/info?full=true`);
    const goodAttestation = await getJson(`http://127.0.0.1:${GOOD_PORT}/attestation?full=true`);
    const goodVerify = await postJson(`http://127.0.0.1:${GOOD_PORT}/api/verify`, {
      transformedSnapshot: goodRecommend.body.transformedSnapshot,
      recommendationSet: goodRecommend.body.recommendationSet,
      arb: goodRecommend.body.arb,
      sourceReceipt: goodRecommend.body.sourceReceipt,
      liveAppInfo: goodInfo.body,
      liveAppAttestation: goodAttestation.body,
    });

    const badRecommend = await postJson(`http://127.0.0.1:${BAD_PORT}/api/recommend?full=true`, { telemetry: sampleTelemetry });
    const badInfo = await getJson(`http://127.0.0.1:${BAD_PORT}/info?full=true`);
    const badAttestation = await getJson(`http://127.0.0.1:${BAD_PORT}/attestation?full=true`);
    const badVerify = await postJson(`http://127.0.0.1:${BAD_PORT}/api/verify`, {
      transformedSnapshot: badRecommend.body.transformedSnapshot,
      recommendationSet: badRecommend.body.recommendationSet,
      arb: badRecommend.body.arb,
      sourceReceipt: badRecommend.body.sourceReceipt,
      liveAppInfo: badInfo.body,
      liveAppAttestation: badAttestation.body,
    });

    assert(goodRecommend.status === 200, "Phala Minimal Cloud App Verification failed: good recommend should return 200.");
    assert(goodVerify.body.ok === true, "Phala Minimal Cloud App Verification failed: verified quote should pass cloud app verification.");
    assert(goodVerify.body.cloudVerification?.quoteVerified === true, "Phala Minimal Cloud App Verification failed: good quote should be marked verified.");
    assert(
      goodVerify.body.cloudVerification?.raw?.quote?.verified === true,
      "Phala Minimal Cloud App Verification failed: compact verify response should keep cloud quote verification status."
    );
    assert(
      goodVerify.body.cloudVerification?.raw?.quote?.hex === undefined,
      "Phala Minimal Cloud App Verification failed: compact verify response should omit the raw cloud quote hex."
    );
    assert(
      goodVerify.body.cloudVerification?.raw?.quote_collateral === undefined,
      "Phala Minimal Cloud App Verification failed: compact verify response should omit cloud quote collateral blobs."
    );
    assert(
      goodVerify.body.liveAppEvidencePolicy?.requireCloudAppVerification === true,
      "Phala Minimal Cloud App Verification failed: live app evidence policy should require cloud verification."
    );

    assert(badVerify.body.ok === false, "Phala Minimal Cloud App Verification failed: unverified quote should fail verification.");
    assert(
      badVerify.body.errors.includes("liveAppAttestation.quote verification via Phala cloud API failed."),
      "Phala Minimal Cloud App Verification failed: missing cloud quote verification failure error."
    );
    assert(badVerify.body.cloudVerification?.quoteVerified === false, "Phala Minimal Cloud App Verification failed: bad quote should be marked unverified.");

    assert(cloudCalls.length === 2, "Phala Minimal Cloud App Verification failed: fake Phala cloud API should receive two verification calls.");
    for (const call of cloudCalls) {
      assert(call.headers["x-api-key"] === CLOUD_API_KEY, "Phala Minimal Cloud App Verification failed: missing X-API-Key header.");
      assert(call.headers["x-phala-version"] === CLOUD_VERSION, "Phala Minimal Cloud App Verification failed: missing X-Phala-Version header.");
    }
    assert(cloudCalls[0].body?.hex === "phala-minimal-cloud-app-verification-quote", "Phala Minimal Cloud App Verification failed: first cloud verification should receive the good quote.");
    assert(
      cloudCalls[1].body?.hex === "phala-minimal-cloud-app-verification-quote-unverified",
      "Phala Minimal Cloud App Verification failed: second cloud verification should receive the unverified quote."
    );

    const templateCompose = await readFile(TEMPLATE_COMPOSE_PATH, "utf8");
    const renderedCompose = await readFile(RENDERED_COMPOSE_PATH, "utf8");
    assert(
      templateCompose.includes('${PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION:-false}'),
      "Phala Minimal Cloud App Verification failed: template compose missing cloud app verification placeholder."
    );
    assert(
      templateCompose.includes('${PHALA_CLOUD_API_BASE_URL:-https://cloud-api.phala.network/api/v1}'),
      "Phala Minimal Cloud App Verification failed: template compose missing Phala API base URL placeholder."
    );
    assert(
      templateCompose.includes('${PHALA_API_VERSION:-2026-01-21}'),
      "Phala Minimal Cloud App Verification failed: template compose missing Phala API version placeholder."
    );
    assert(
      templateCompose.includes('${PHALA_CLOUD_API_KEY:-}'),
      "Phala Minimal Cloud App Verification failed: template compose missing Phala API key placeholder."
    );
    assert(
      renderedCompose.includes(`PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "true"`),
      "Phala Minimal Cloud App Verification failed: rendered compose missing concrete cloud verification policy value."
    );
    assert(
      renderedCompose.includes(`PHALA_CLOUD_API_BASE_URL: "http://127.0.0.1:${CLOUD_PORT}"`),
      "Phala Minimal Cloud App Verification failed: rendered compose missing concrete Phala API base URL."
    );
    assert(
      renderedCompose.includes(`PHALA_API_VERSION: "${CLOUD_VERSION}"`),
      "Phala Minimal Cloud App Verification failed: rendered compose missing concrete Phala API version."
    );
    assert(
      renderedCompose.includes(`PHALA_CLOUD_API_KEY: "${CLOUD_API_KEY}"`),
      "Phala Minimal Cloud App Verification failed: rendered compose missing concrete Phala API key."
    );

    const artifact = {
      schemaVersion: "phala-minimal-cloud-app-verification-v1",
      good: {
        recommend: goodRecommend.body,
        info: goodInfo.body,
        attestation: goodAttestation.body,
        verify: goodVerify.body,
      },
      bad: {
        recommend: badRecommend.body,
        info: badInfo.body,
        attestation: badAttestation.body,
        verify: badVerify.body,
      },
      fakeCloudCalls: cloudCalls,
      syncProcess,
      servers: {
        good: goodServer.getOutput(),
        bad: badServer.getOutput(),
      },
      doneCondition:
        "The minimal Phala prototype can require quote verification through the Phala cloud API during live app evidence verification and reject quotes the cloud verifier does not accept.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Phala Minimal Cloud App Verification artifact: ${ARTIFACT_PATH}`);
    console.log(`Good quote verified: ${goodVerify.body.cloudVerification?.quoteVerified === true}`);
    console.log(`Bad quote rejected: ${badVerify.body.ok === false}`);
    console.log("Phala Minimal Cloud App Verification test: PASS");
  } finally {
    goodServer.child.kill("SIGTERM");
    badServer.child.kill("SIGTERM");
    await new Promise((resolve) => fakeCloudServer.close(resolve));
  }
}

main().catch((error) => {
  console.error("Phala Minimal Cloud App Verification test failed.", error);
  process.exitCode = 1;
});


