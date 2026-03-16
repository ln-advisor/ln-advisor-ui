import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step39.phala-minimal-prototype.json");
const SERVER_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "server.mjs");
const DOCKERFILE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "Dockerfile");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const DEPLOY_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "phala-minimal-deploy.sh");
const PORT = 8801;

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

async function main() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(PORT),
      PROTOTYPE_SERVICE_NAME: "ln-advisor-phala-minimal-test",
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

    const sampleTelemetry = {
      nodeAlias: "step39-node",
      channels: [
        {
          channelId: "100x1x0",
          peerPubkey: "02aaaa",
          active: true,
          localBalanceSat: 600000,
          remoteBalanceSat: 400000,
          outboundFeePpm: 250,
          forwardCount: 4,
          revenueSat: 120,
          failedForwardCount: 0,
        },
      ],
    };

    const healthResponse = await fetch(`http://127.0.0.1:${PORT}/health`).then((response) => response.json());
    const snapshotResponse = await postJson(`http://127.0.0.1:${PORT}/api/snapshot`, {
      telemetry: sampleTelemetry,
      privacyMode: "feature_only",
    });
    const recommendResponse = await postJson(`http://127.0.0.1:${PORT}/api/recommend`, {
      telemetry: sampleTelemetry,
    });
    const verifyPassResponse = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      transformedSnapshot: recommendResponse.body.transformedSnapshot,
      recommendationSet: recommendResponse.body.recommendationSet,
      arb: recommendResponse.body.arb,
    });
    const verifyFailResponse = await postJson(`http://127.0.0.1:${PORT}/api/verify`, {
      arb: { arbVersion: "wrong-bundle" },
    });

    assert(healthResponse.ok === true, "Step39 failed: /health did not return ok=true.");
    assert(snapshotResponse.status === 200, "Step39 failed: /api/snapshot did not return 200.");
    assert(snapshotResponse.body.ok === true, "Step39 failed: /api/snapshot did not return ok=true.");
    assert(recommendResponse.status === 200, "Step39 failed: /api/recommend did not return 200.");
    assert(
      recommendResponse.body.recommendationSet?.feeRecommendations?.length === 1,
      "Step39 failed: /api/recommend did not return deterministic fee recommendations."
    );
    assert(verifyPassResponse.body.ok === true, "Step39 failed: prototype verify pass response should be ok=true.");
    assert(verifyFailResponse.body.ok === false, "Step39 failed: prototype verify fail response should be ok=false.");

    const composeSource = await readFile(COMPOSE_PATH, "utf8");
    const deployScriptSource = await readFile(DEPLOY_SCRIPT_PATH, "utf8");
    const dockerfileSource = await readFile(DOCKERFILE_PATH, "utf8");
    assert(dockerfileSource.includes("server.mjs"), "Step39 failed: Dockerfile no longer documents the standalone server image.");
    assert(composeSource.includes("8787:8787"), "Step39 failed: docker-compose is missing port mapping.");
    assert(composeSource.includes("image: node:22-alpine"), "Step39 failed: docker-compose is not using the stock Node alpine image.");
    assert(composeSource.includes("platform: linux/amd64"), "Step39 failed: docker-compose is missing explicit linux/amd64 platform.");
    assert(composeSource.includes("- -e"), "Step39 failed: docker-compose is not launching node with -e.");
    assert(deployScriptSource.includes("phala deploy"), "Step39 failed: deploy script does not call phala deploy.");

    const artifact = {
      schemaVersion: "step39-phala-minimal-prototype-v1",
      healthResponse,
      snapshotResponse: snapshotResponse.body,
      recommendResponse: recommendResponse.body,
      verifyPassResponse: verifyPassResponse.body,
      verifyFailResponse: verifyFailResponse.body,
      scaffold: {
        serverPath: SERVER_PATH,
        dockerfilePath: DOCKERFILE_PATH,
        composePath: COMPOSE_PATH,
        deployScriptPath: DEPLOY_SCRIPT_PATH,
      },
      process: {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      },
      doneCondition:
        "A minimal hardcoded API can run locally with the same routes intended for Phala deployment, and the repo includes a low-cost Phala deploy scaffold for it.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 39 artifact: ${ARTIFACT_PATH}`);
    console.log(`Health endpoint ok: ${healthResponse.ok === true}`);
    console.log(`Recommend endpoint ok: ${recommendResponse.body.ok === true}`);
    console.log(`Prototype verify pass: ${verifyPassResponse.body.ok === true}`);
    console.log("Step 39 phala minimal prototype test: PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("Step 39 phala minimal prototype test failed.", error);
  process.exitCode = 1;
});
