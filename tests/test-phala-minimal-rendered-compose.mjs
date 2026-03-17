import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-rendered-compose.json");
const SYNC_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "sync-phala-minimal-inline.mjs");
const TEMPLATE_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.yml");
const RENDERED_COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");
const TEMP_ENV_PATH = path.resolve(process.cwd(), "artifacts", "phala-minimal-rendered-compose.env");

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

async function main() {
  await mkdir(path.dirname(TEMP_ENV_PATH), { recursive: true });
  await writeFile(
    TEMP_ENV_PATH,
    [
      "PROTOTYPE_SIGNER_PROVIDER_ID=rendered-env-file-signer-v1",
      "PROTOTYPE_ATTESTATION_MEASUREMENT=rendered-file-measurement-v1",
      "PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT=false",
    ].join("\n") + "\n",
    "utf8"
  );

  const child = spawn(process.execPath, [SYNC_SCRIPT_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PHALA_MINIMAL_ENV_FILE: TEMP_ENV_PATH,
      PROTOTYPE_SIGNER_PROVIDER_ID: "rendered-env-signer-v1",
      PROTOTYPE_ATTESTATION_MEASUREMENT: "rendered-shell-measurement-v1",
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true",
      PROTOTYPE_ARB_SIGNING_KEY: "rendered-signing-key-v1",
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

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  assert(exitCode === 0, "Phala Minimal Rendered Compose failed: sync script did not exit cleanly.");

  const templateCompose = await readFile(TEMPLATE_COMPOSE_PATH, "utf8");
  const renderedCompose = await readFile(RENDERED_COMPOSE_PATH, "utf8");

  assert(templateCompose.includes('${PROTOTYPE_SIGNER_PROVIDER_ID:-prototype-env-signer-v1}'), "Phala Minimal Rendered Compose failed: template compose should keep signer provider placeholder.");
  assert(renderedCompose.includes('rendered-env-signer-v1'), "Phala Minimal Rendered Compose failed: rendered compose missing concrete signer provider value.");
  assert(renderedCompose.includes('rendered-shell-measurement-v1'), "Phala Minimal Rendered Compose failed: rendered compose missing concrete attestation measurement value.");
  assert(renderedCompose.includes('PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true"'), "Phala Minimal Rendered Compose failed: rendered compose missing concrete source receipt policy value.");
  assert(
    renderedCompose.includes('PHALA_CLOUD_API_KEY: ""'),
    "Phala Minimal Rendered Compose failed: rendered compose should still resolve empty-string env placeholders."
  );
  assert(!renderedCompose.includes('${PROTOTYPE_SIGNER_PROVIDER_ID:-prototype-env-signer-v1}'), "Phala Minimal Rendered Compose failed: rendered compose should not keep unresolved signer provider placeholder.");
  assert(
    !renderedCompose.includes('rendered-env-file-signer-v1'),
    "Phala Minimal Rendered Compose failed: shell env should override file signer provider value."
  );

  const artifact = {
    schemaVersion: "phala-minimal-rendered-compose-v1",
    templateChecks: {
      keepsPlaceholders: true,
    },
    renderedChecks: {
      signerProviderId: renderedCompose.includes('rendered-env-signer-v1'),
      attestationMeasurement: renderedCompose.includes('rendered-shell-measurement-v1'),
      requireSourceReceipt: renderedCompose.includes('PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "true"'),
      envFileLoaded: stdout.includes('phala-minimal-rendered-compose.env'),
    },
    process: {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    },
    doneCondition:
      "The Phala minimal sync step emits both a template compose file and a rendered compose file with concrete runtime values from the current environment.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

  console.log(`Saved Phala Minimal Rendered Compose artifact: ${ARTIFACT_PATH}`);
  console.log(`Rendered compose contains concrete values: ${artifact.renderedChecks.signerProviderId && artifact.renderedChecks.attestationMeasurement}`);
  console.log("Phala Minimal Rendered Compose test: PASS");
}

main().catch((error) => {
  console.error("Phala Minimal Rendered Compose test failed.", error);
  process.exitCode = 1;
});

