import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT_DIR = process.cwd();
const ARTIFACT_PATH = path.resolve(ROOT_DIR, "artifacts", "phala-minimal-pinned-runtime-measurement.json");
const PIN_SCRIPT_PATH = "scripts/phala-minimal-pin-runtime-measurement.sh";
const SERVER_PATH = path.resolve(ROOT_DIR, "deploy", "phala-minimal-prototype", "server.mjs");
const RENDERED_COMPOSE_PATH = path.resolve(ROOT_DIR, "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");

const APP_PORT = 8822;
const CLOUD_VERSION = "2026-03-16-phala-minimal-pinned-runtime-measurement";
const CLOUD_API_KEY = "phala-minimal-pinned-runtime-measurement-cloud-api-key";
const REAL_MEASUREMENT = "ab".repeat(48);
const PLACEHOLDER_MEASUREMENT = "runtime-discovery-placeholder";
const RUNTIME_QUOTE_HEX = "cd".repeat(256);

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

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return { status: response.status, body: await response.json() };
}

const parseEnvFile = (text) => {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    env[key] = value;
  }
  return env;
};

async function main() {
  const tempDir = path.resolve(ROOT_DIR, "artifacts", "phala-minimal-pinned-runtime-measurement-temp");
  await mkdir(tempDir, { recursive: true });
  const envFile = path.join(tempDir, "minimal.env");
  const relativeEnvFile = path.relative(ROOT_DIR, envFile).replace(/\\/g, "/");

  const initialEnv = [
    "PHALA_CVM_NAME=ln-advisor-phala-minimal-phala-minimal-pinned-runtime-measurement",
    "PROTOTYPE_SERVICE_NAME=ln-advisor-phala-minimal-phala-minimal-pinned-runtime-measurement",
    "PROTOTYPE_ATTESTATION_SOURCE=dstack_runtime",
    "PROTOTYPE_VERIFY_REQUIRE_ATTESTATION=true",
    `PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT=${PLACEHOLDER_MEASUREMENT}`,
    `PROTOTYPE_ATTESTATION_MEASUREMENT=${PLACEHOLDER_MEASUREMENT}`,
  ].join("\n") + "\n";
  await writeFile(envFile, initialEnv, "utf8");

  const attestationFile = path.join(tempDir, "attestation.json");
  const relativeAttestationFile = path.relative(ROOT_DIR, attestationFile).replace(/\\/g, "/");
  await writeFile(
    attestationFile,
    stableJson({
      measurement: PLACEHOLDER_MEASUREMENT,
      quote: RUNTIME_QUOTE_HEX,
      schemaVersion: "prototype-app-attestation-v1",
    }),
    "utf8"
  );

  try {
    const pinProcess = spawn(
      "bash",
      [
        "-lc",
        [
          `export PHALA_CLOUD_API_KEY='${CLOUD_API_KEY}'`,
          `export PHALA_CLOUD_API_BASE_URL='https://example.invalid/api/v1'`,
          `export PHALA_API_VERSION='${CLOUD_VERSION}'`,
          `curl(){ printf '%s\n' '${JSON.stringify({
            success: true,
            quote: {
              verified: true,
              body: {
                mrtd: `0x${REAL_MEASUREMENT}`,
              },
            },
          }).replace(/'/g, `'\\''`)}'; }`,
          `set -- ${relativeEnvFile} ${relativeAttestationFile}`,
          `source ${PIN_SCRIPT_PATH}`,
        ].join("; "),
      ],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let pinStdout = "";
    let pinStderr = "";
    pinProcess.stdout.on("data", (chunk) => {
      pinStdout += chunk.toString();
    });
    pinProcess.stderr.on("data", (chunk) => {
      pinStderr += chunk.toString();
    });

    const pinExitCode = await new Promise((resolve) => pinProcess.on("close", resolve));
    assert(
      pinExitCode === 0,
      `Phala Minimal Pinned Runtime Measurement failed: pin script did not exit cleanly.\nstdout:\n${pinStdout}\nstderr:\n${pinStderr}`
    );

    const envContents = await readFile(envFile, "utf8");
    const parsedEnv = parseEnvFile(envContents);
    assert(
      parsedEnv.PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT === REAL_MEASUREMENT,
      "Phala Minimal Pinned Runtime Measurement failed: pin script did not update PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT."
    );
    assert(
      parsedEnv.PROTOTYPE_ATTESTATION_MEASUREMENT === REAL_MEASUREMENT,
      "Phala Minimal Pinned Runtime Measurement failed: pin script did not update PROTOTYPE_ATTESTATION_MEASUREMENT."
    );

    const appProcess = spawn(process.execPath, [SERVER_PATH], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...parsedEnv,
        API_PORT: String(APP_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let appStdout = "";
    let appStderr = "";
    appProcess.stdout.on("data", (chunk) => {
      appStdout += chunk.toString();
    });
    appProcess.stderr.on("data", (chunk) => {
      appStderr += chunk.toString();
    });

    try {
      await sleep(900);
      const health = await getJson(`http://127.0.0.1:${APP_PORT}/health`);
      assert(health.status === 200, "Phala Minimal Pinned Runtime Measurement failed: health should return 200.");
      assert(
        health.body?.measurementPolicy?.pinned === true,
        "Phala Minimal Pinned Runtime Measurement failed: health should report measurement policy as pinned."
      );
      assert(
        health.body?.measurementPolicy?.allowedMeasurement === REAL_MEASUREMENT,
        "Phala Minimal Pinned Runtime Measurement failed: health allowedMeasurement mismatch."
      );
      assert(
        health.body?.measurementPolicy?.placeholderDetected === false,
        "Phala Minimal Pinned Runtime Measurement failed: health should not report placeholderDetected after pinning."
      );

      const renderedCompose = await readFile(RENDERED_COMPOSE_PATH, "utf8");
      assert(
        renderedCompose.includes(`PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "${REAL_MEASUREMENT}"`),
        "Phala Minimal Pinned Runtime Measurement failed: rendered compose missing pinned verify measurement."
      );
      assert(
        renderedCompose.includes(`PROTOTYPE_ATTESTATION_MEASUREMENT: "${REAL_MEASUREMENT}"`),
        "Phala Minimal Pinned Runtime Measurement failed: rendered compose missing pinned attestation measurement."
      );

      const artifact = {
        schemaVersion: "phala-minimal-pinned-runtime-measurement-v1",
        envFile,
        pinnedMeasurement: REAL_MEASUREMENT,
        health: health.body,
        pinProcess: {
          stdout: pinStdout.trim(),
          stderr: pinStderr.trim(),
        },
        appProcess: {
          stdout: appStdout.trim(),
          stderr: appStderr.trim(),
        },
        doneCondition:
          "The minimal Phala prototype can pin a discovered runtime measurement into the deploy env, rerender compose with that pinned value, and expose pinned measurement policy status via /health.",
      };

      await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
      await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

      console.log(`Saved Phala Minimal Pinned Runtime Measurement artifact: ${ARTIFACT_PATH}`);
      console.log(`Pinned measurement written: ${parsedEnv.PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT === REAL_MEASUREMENT}`);
      console.log(`Health reports pinned measurement: ${health.body?.measurementPolicy?.pinned === true}`);
      console.log("Phala Minimal Pinned Runtime Measurement test: PASS");
    } finally {
      appProcess.kill("SIGTERM");
    }
  } finally {
  }
}

main().catch((error) => {
  console.error("Phala Minimal Pinned Runtime Measurement test failed.", error);
  process.exitCode = 1;
});


