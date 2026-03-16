import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step54.phala-minimal-real-attestation-source.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const SYNC_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "sync-phala-minimal-inline.mjs");
const TEMPLATE_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const RENDERED_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");

const APP_PORT = 8820;
const BAD_APP_PORT = 8821;
const DSTACK_PORT = 8924;
const CLOUD_PORT = 8925;
const CLOUD_VERSION = "2026-03-14-step54";
const CLOUD_API_KEY = "step54-cloud-api-key";
const RUNTIME_RECOMMEND_QUOTE_HEX = "ab".repeat(256);
const RUNTIME_LIVE_ATTESTATION_QUOTE_HEX = "cd".repeat(256);
const RUNTIME_MISMATCHED_EVENT_DIGEST = "ef".repeat(32);

const sampleTelemetry = {
  nodeAlias: "phala-step54-node",
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
      PROTOTYPE_ATTESTATION_SOURCE: "dstack_runtime",
      PROTOTYPE_DSTACK_ENDPOINT: `http://127.0.0.1:${DSTACK_PORT}`,
      PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "true",
      PHALA_CLOUD_API_BASE_URL: `http://127.0.0.1:${CLOUD_PORT}`,
      PHALA_API_VERSION: CLOUD_VERSION,
      PHALA_CLOUD_API_KEY: CLOUD_API_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert(exitCode === 0, "Step54 failed: sync script did not exit cleanly.");
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function startPrototypeServer(port, extraEnv) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      PROTOTYPE_SERVICE_NAME: `ln-advisor-phala-minimal-step54-${port}`,
      PROTOTYPE_ARB_SIGNING_KEY: "step54-signing-key",
      PROTOTYPE_SIGNER_PROVIDER_ID: "prototype-env-signer-step54",
      PROTOTYPE_VERIFY_REQUIRE_ATTESTATION: "true",
      PROTOTYPE_VERIFY_MIN_EXECUTION_MODE: "tee_verified",
      PROTOTYPE_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_ATTESTATION_EXECUTION_MODE: "tee_verified",
      PROTOTYPE_ATTESTATION_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "step54-measurement",
      PROTOTYPE_ATTESTATION_SOURCE: "dstack_runtime",
      PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID: "phala-cloud",
      PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "step54-measurement",
      PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT: "tdx_quote",
      PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING: "true",
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true",
      PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE: "true",
      PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "true",
      PROTOTYPE_DSTACK_ENDPOINT: `http://127.0.0.1:${DSTACK_PORT}`,
      PHALA_CLOUD_API_BASE_URL: `http://127.0.0.1:${CLOUD_PORT}`,
      PHALA_API_VERSION: CLOUD_VERSION,
      PHALA_CLOUD_API_KEY: CLOUD_API_KEY,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

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
  const dstackCalls = [];
  const cloudCalls = [];
  let quoteRequestCount = 0;

  const runtimeAppCompose = JSON.stringify({
    schemaVersion: "prototype-app-compose-v1",
    serviceName: "ln-advisor-phala-minimal-runtime",
    verifyPolicy: {
      requireAttestation: true,
      requireCloudAppVerification: true,
      requireLiveAppEvidence: true,
      requireReportDataBinding: true,
      requireSourceReceipt: true,
    },
  });
  const runtimeComposeHash = createHash("sha256").update(runtimeAppCompose, "utf8").digest("hex");

  const fakeDstackServer = http.createServer(async (req, res) => {
    if (req.url === "/Info") {
      dstackCalls.push({ path: req.url, method: req.method, body: req.method === "POST" ? await collectJsonBody(req) : null });
      const payload = {
        app_id: "step54-app-id",
        instance_id: "step54-instance-id",
        tcb_info: {
          app_compose: runtimeAppCompose,
          compose_hash: runtimeComposeHash,
        },
      };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(payload)}\n`);
      return;
    }

    if (req.url === "/GetQuote" && req.method === "POST") {
      const body = await collectJsonBody(req);
      dstackCalls.push({ path: req.url, method: req.method, body });
      const reportData = typeof body?.reportData === "string" ? body.reportData.trim().replace(/^0x/, "").toLowerCase() : "";
      const runtimeQuote = quoteRequestCount === 0 ? RUNTIME_RECOMMEND_QUOTE_HEX : RUNTIME_LIVE_ATTESTATION_QUOTE_HEX;
      const eventDigest = quoteRequestCount < 2 ? runtimeComposeHash : RUNTIME_MISMATCHED_EVENT_DIGEST;
      quoteRequestCount += 1;
      const payload = {
        quote: runtimeQuote,
        event_log: [
          {
            imr: 3,
            event: "app-compose-hash",
            digest: eventDigest,
          },
        ],
        report_data: reportData,
      };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(payload)}\n`);
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end('{"ok":false}\n');
  });

  const fakeCloudServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/attestations/verify") {
      const body = await collectJsonBody(req);
      cloudCalls.push({
        path: req.url,
        method: req.method,
        headers: req.headers,
        body,
      });
      const quoteVerified =
        body?.hex === RUNTIME_RECOMMEND_QUOTE_HEX || body?.hex === RUNTIME_LIVE_ATTESTATION_QUOTE_HEX;
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        `${JSON.stringify({
          success: true,
          quote: {
            verified: quoteVerified,
            hex: body?.hex || null,
            body: {
              mrtd: "step54-measurement",
            },
          },
        })}\n`
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end('{"ok":false}\n');
  });

  await new Promise((resolve) => fakeDstackServer.listen(DSTACK_PORT, "127.0.0.1", resolve));
  await new Promise((resolve) => fakeCloudServer.listen(CLOUD_PORT, "127.0.0.1", resolve));

  const syncProcess = await runSyncWithRenderValues();
  const goodServer = await startPrototypeServer(APP_PORT, {});
  const badServer = await startPrototypeServer(BAD_APP_PORT, {
    PROTOTYPE_DSTACK_ENDPOINT: "http://127.0.0.1:8999",
  });

  try {
    const recommend = await postJson(`http://127.0.0.1:${APP_PORT}/api/recommend?full=true`, { telemetry: sampleTelemetry });
    const info = await getJson(`http://127.0.0.1:${APP_PORT}/info?full=true`);
    const attestation = await getJson(`http://127.0.0.1:${APP_PORT}/attestation?full=true`);
    const verify = await postJson(`http://127.0.0.1:${APP_PORT}/api/verify`, {
      transformedSnapshot: recommend.body.transformedSnapshot,
      recommendationSet: recommend.body.recommendationSet,
      arb: recommend.body.arb,
      sourceReceipt: recommend.body.sourceReceipt,
      liveAppInfo: info.body,
      liveAppAttestation: attestation.body,
    });
    const brokenRecommend = await postJson(`http://127.0.0.1:${BAD_APP_PORT}/api/recommend`, { telemetry: sampleTelemetry });

    assert(recommend.status === 200, "Step54 failed: runtime-backed recommend should return 200.");
    assert(
      recommend.body.arb?.attestation?.quote === RUNTIME_RECOMMEND_QUOTE_HEX,
      "Step54 failed: ARB attestation quote should come from the first dstack runtime quote."
    );
    assert(info.body?.tcb_info?.app_compose === runtimeAppCompose, "Step54 failed: /info should return runtime app_compose.");
    assert(
      attestation.body?.quote === RUNTIME_LIVE_ATTESTATION_QUOTE_HEX,
      "Step54 failed: /attestation should return the later runtime quote."
    );
    assert(attestation.body?.report_data === recommend.body.arb.digest, "Step54 failed: /attestation report_data should match digest.");
    assert(verify.body.ok === true, "Step54 failed: runtime-backed quote should pass verification.");
    assert(verify.body.cloudVerification?.quoteVerified === true, "Step54 failed: cloud verification should accept runtime-backed quote.");
    assert(
      verify.body.warnings?.includes(
        "Live runtime attestation event_log compose hash differed from /info compose_hash; verification relied on /info compose_hash plus cloud quote verification."
      ),
      "Step54 failed: runtime compose-hash event-log mismatch should downgrade to warning."
    );
    assert(brokenRecommend.status === 503, "Step54 failed: required dstack runtime source should fail closed when unavailable.");

    assert(dstackCalls.some((call) => call.path === "/Info"), "Step54 failed: fake dstack Info endpoint was not called.");
    assert(dstackCalls.some((call) => call.path === "/GetQuote"), "Step54 failed: fake dstack GetQuote endpoint was not called.");
    assert(cloudCalls.length >= 1, "Step54 failed: fake cloud verify endpoint was not called.");
    assert(cloudCalls[0].headers["x-api-key"] === CLOUD_API_KEY, "Step54 failed: missing X-API-Key header.");
    assert(cloudCalls[0].headers["x-phala-version"] === CLOUD_VERSION, "Step54 failed: missing X-Phala-Version header.");
    assert(
      cloudCalls.some((call) => call.body?.hex === RUNTIME_RECOMMEND_QUOTE_HEX),
      "Step54 failed: cloud verification should receive the runtime quote used for ARB generation."
    );
    assert(
      cloudCalls.some((call) => call.body?.hex === RUNTIME_LIVE_ATTESTATION_QUOTE_HEX),
      "Step54 failed: cloud verification should receive the live attestation quote hex."
    );

    const templateCompose = await readFile(TEMPLATE_COMPOSE_PATH, "utf8");
    const renderedCompose = await readFile(RENDERED_COMPOSE_PATH, "utf8");
    assert(templateCompose.includes("/var/run/dstack.sock:/var/run/dstack.sock"), "Step54 failed: compose scaffold missing dstack.sock mount.");
    assert(templateCompose.includes('${PROTOTYPE_ATTESTATION_SOURCE:-prototype_env}'), "Step54 failed: template compose missing attestation source placeholder.");
    assert(templateCompose.includes('${PROTOTYPE_DSTACK_ENDPOINT:-}'), "Step54 failed: template compose missing dstack endpoint placeholder.");
    assert(renderedCompose.includes('PROTOTYPE_ATTESTATION_SOURCE: "dstack_runtime"'), "Step54 failed: rendered compose missing concrete attestation source.");
    assert(renderedCompose.includes(`PROTOTYPE_DSTACK_ENDPOINT: "http://127.0.0.1:${DSTACK_PORT}"`), "Step54 failed: rendered compose missing concrete dstack endpoint.");

    const artifact = {
      schemaVersion: "step54-phala-minimal-real-attestation-source-v1",
      good: {
        recommend: recommend.body,
        info: info.body,
        attestation: attestation.body,
        verify: verify.body,
      },
      brokenRecommend: brokenRecommend.body,
      dstackCalls,
      cloudCalls,
      syncProcess,
      servers: {
        good: goodServer.getOutput(),
        bad: badServer.getOutput(),
      },
      doneCondition:
        "The minimal Phala prototype can switch to a dstack runtime attestation source, embed the runtime quote into the ARB, expose the same quote via /attestation, and pass live app evidence verification against the cloud verifier path.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 54 artifact: ${ARTIFACT_PATH}`);
    console.log(
      `Runtime quote used in ARB: ${recommend.body.arb?.attestation?.quote === RUNTIME_RECOMMEND_QUOTE_HEX}`
    );
    console.log(`Runtime-backed verification passed: ${verify.body.ok === true}`);
    console.log("Step 54 phala minimal real attestation source test: PASS");
  } finally {
    goodServer.child.kill("SIGTERM");
    badServer.child.kill("SIGTERM");
    await new Promise((resolve) => fakeDstackServer.close(resolve));
    await new Promise((resolve) => fakeCloudServer.close(resolve));
  }
}

main().catch((error) => {
  console.error("Step 54 phala minimal real attestation source test failed.", error);
  process.exitCode = 1;
});
