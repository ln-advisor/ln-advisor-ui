import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const serverPath = path.resolve(root, "deploy", "phala-minimal-prototype", "server.mjs");
const composePath = path.resolve(root, "deploy", "phala-minimal-prototype", "docker-compose.yml");
const renderedComposePath = path.resolve(root, "deploy", "phala-minimal-prototype", "docker-compose.rendered.yml");
const defaultEnvPath = path.resolve(root, "deploy", "phala-minimal-prototype", ".env");
const envFilePath = process.env.PHALA_MINIMAL_ENV_FILE
  ? path.resolve(root, process.env.PHALA_MINIMAL_ENV_FILE)
  : defaultEnvPath;

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    env[key] = value;
  }
  return env;
};

const fileEnv = parseEnvFile(envFilePath);
const renderEnv = {
  ...fileEnv,
  ...process.env,
};

const serverSource = await readFile(serverPath, "utf8");
// Docker Compose treats `$` as interpolation syntax, so embedded JS template
// literals must be doubled to survive into the container command unchanged.
const escapedSource = serverSource.replace(/\$/g, "$$$$");
const indentedSource = escapedSource
  .trimEnd()
  .split(/\r?\n/)
  .map((line) => `        ${line}`)
  .join("\n");

const composeSource = `services:
  minimal-props-api:
    image: node:22-alpine
    platform: linux/amd64
    ports:
      - "8787:8787"
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    environment:
      API_PORT: "8787"
      PROTOTYPE_SERVICE_NAME: "\${PROTOTYPE_SERVICE_NAME:-ln-advisor-phala-minimal}"
      PROTOTYPE_SIGNER_PROVIDER_TYPE: "\${PROTOTYPE_SIGNER_PROVIDER_TYPE:-env_hmac}"
      PROTOTYPE_SIGNER_PROVIDER_ID: "\${PROTOTYPE_SIGNER_PROVIDER_ID:-prototype-env-signer-v1}"
      PROTOTYPE_SIGNER_PROVIDER_UNAVAILABLE_REASON: "\${PROTOTYPE_SIGNER_PROVIDER_UNAVAILABLE_REASON:-Signer provider is not available in the minimal prototype.}"
      PROTOTYPE_ARB_SIGNING_KEY: "\${PROTOTYPE_ARB_SIGNING_KEY:-prototype-dev-signing-key-change-me}"
      PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY: "\${PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY:-false}"
      PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID: "\${PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID:-prototype-env-signer-v1}"
      PROTOTYPE_ARB_VERIFY_EXPECTED_SIGNER_PROVIDER_TYPE: "\${PROTOTYPE_ARB_VERIFY_EXPECTED_SIGNER_PROVIDER_TYPE:-env_hmac}"
      PROTOTYPE_ATTESTATION_INCLUDE: "\${PROTOTYPE_ATTESTATION_INCLUDE:-true}"
      PROTOTYPE_ATTESTATION_PROVIDER_ID: "\${PROTOTYPE_ATTESTATION_PROVIDER_ID:-phala-cloud}"
      PROTOTYPE_ATTESTATION_EXECUTION_MODE: "\${PROTOTYPE_ATTESTATION_EXECUTION_MODE:-tee_verified}"
      PROTOTYPE_ATTESTATION_QUOTE_FORMAT: "\${PROTOTYPE_ATTESTATION_QUOTE_FORMAT:-tdx_quote}"
      PROTOTYPE_ATTESTATION_MEASUREMENT: "\${PROTOTYPE_ATTESTATION_MEASUREMENT:-prototype-measurement-v1}"
      PROTOTYPE_ATTESTATION_QUOTE: "\${PROTOTYPE_ATTESTATION_QUOTE:-prototype-phala-quote}"
      PROTOTYPE_ATTESTATION_ISSUED_AT: "\${PROTOTYPE_ATTESTATION_ISSUED_AT:-2026-03-13T00:00:00Z}"
      PROTOTYPE_ATTESTATION_NONCE: "\${PROTOTYPE_ATTESTATION_NONCE:-prototype-attestation-nonce}"
      PROTOTYPE_ATTESTATION_SOURCE: "\${PROTOTYPE_ATTESTATION_SOURCE:-prototype_env}"
      PROTOTYPE_DSTACK_ENDPOINT: "\${PROTOTYPE_DSTACK_ENDPOINT:-}"
      PROTOTYPE_DSTACK_SOCKET_PATH: "\${PROTOTYPE_DSTACK_SOCKET_PATH:-}"
      PROTOTYPE_VERIFY_REQUIRE_ATTESTATION: "\${PROTOTYPE_VERIFY_REQUIRE_ATTESTATION:-false}"
      PROTOTYPE_VERIFY_MIN_EXECUTION_MODE: "\${PROTOTYPE_VERIFY_MIN_EXECUTION_MODE:-local_dev}"
      PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID: "\${PROTOTYPE_VERIFY_ALLOWED_ATTESTATION_PROVIDER_ID:-phala-cloud}"
      PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT: "\${PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT:-prototype-measurement-v1}"
      PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT: "\${PROTOTYPE_VERIFY_ALLOWED_QUOTE_FORMAT:-tdx_quote}"
      PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING: "\${PROTOTYPE_VERIFY_REQUIRE_REPORT_DATA_BINDING:-true}"
      PROTOTYPE_SOURCE_RECEIPT_COLLECTED_AT: "\${PROTOTYPE_SOURCE_RECEIPT_COLLECTED_AT:-2026-03-13T00:00:00Z}"
      PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT: "\${PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT:-false}"
      PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE: "\${PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE:-false}"
      PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION: "\${PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION:-false}"
      PHALA_CLOUD_API_BASE_URL: "\${PHALA_CLOUD_API_BASE_URL:-https://cloud-api.phala.network/api/v1}"
      PHALA_API_VERSION: "\${PHALA_API_VERSION:-2026-01-21}"
      PHALA_CLOUD_API_KEY: "\${PHALA_CLOUD_API_KEY:-}"
    command:
      - node
      - --input-type=module
      - -e
      - |
${indentedSource}
`;

const renderedComposeSource = composeSource.replace(/\$\{([A-Z0-9_]+):-([^}]*)\}/g, (_, name, fallback) => {
  const resolved = renderEnv[name] && renderEnv[name].length > 0 ? renderEnv[name] : fallback;
  return String(resolved).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
});

await writeFile(composePath, composeSource, "utf8");
await writeFile(renderedComposePath, renderedComposeSource, "utf8");

console.log(`Synced ${path.relative(root, composePath)} from ${path.relative(root, serverPath)}`);
console.log(
  `Rendered ${path.relative(root, renderedComposePath)} using ${fs.existsSync(envFilePath) ? path.relative(root, envFilePath) : "current environment"} values`
);
