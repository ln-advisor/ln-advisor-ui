#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/deploy/phala-minimal-prototype/.env"
ENV_FILE="${1:-$DEFAULT_ENV_FILE}"
APP_URL_INPUT="${2:-${APP_URL:-}}"
NODE_BIN="${NODE_BIN:-$(command -v node || command -v node.exe || true)}"
RUNTIME_MEASUREMENT_PLACEHOLDER="${PROTOTYPE_RUNTIME_MEASUREMENT_PLACEHOLDER:-runtime-discovery-placeholder}"
PHALA_CLOUD_API_BASE_URL="${PHALA_CLOUD_API_BASE_URL:-https://cloud-api.phala.network/api/v1}"
PHALA_API_VERSION="${PHALA_API_VERSION:-2026-01-21}"

if [[ -z "${APP_URL_INPUT}" ]]; then
  echo "usage: bash scripts/phala-minimal-pin-runtime-measurement.sh [env-file] <app-url-or-attestation-json-file>" >&2
  echo "   or: APP_URL=https://... bash scripts/phala-minimal-pin-runtime-measurement.sh [env-file]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ -z "$NODE_BIN" ]]; then
  echo "node is required" >&2
  exit 1
fi

if [[ -f "$APP_URL_INPUT" ]]; then
  ATTESTATION_JSON="$(cat "$APP_URL_INPUT")"
else
  APP_URL="${APP_URL_INPUT%/}"
  ATTESTATION_JSON="$(curl -fsS "$APP_URL/attestation")"
fi
MEASUREMENT="$(
  printf '%s\n' "$ATTESTATION_JSON" \
    | "$NODE_BIN" -e 'const fs=require("node:fs"); const text=fs.readFileSync(0,"utf8"); const parsed=JSON.parse(text); process.stdout.write(typeof parsed.measurement === "string" ? parsed.measurement : "");'
)"
QUOTE_HEX="$(
  printf '%s\n' "$ATTESTATION_JSON" \
    | "$NODE_BIN" -e 'const fs=require("node:fs"); const text=fs.readFileSync(0,"utf8"); const parsed=JSON.parse(text); process.stdout.write(typeof parsed.quote === "string" ? parsed.quote : "");'
)"

if [[ -z "$MEASUREMENT" || "$MEASUREMENT" == "null" || "$MEASUREMENT" == "$RUNTIME_MEASUREMENT_PLACEHOLDER" ]]; then
  if [[ -n "$QUOTE_HEX" && "$QUOTE_HEX" != "null" ]]; then
    if [[ -z "${PHALA_CLOUD_API_KEY:-}" ]]; then
      echo "PHALA_CLOUD_API_KEY is required to derive runtime measurement from quote verification." >&2
      exit 1
    fi

    CLOUD_VERIFY_JSON="$(
      curl -fsS -X POST "$PHALA_CLOUD_API_BASE_URL/attestations/verify" \
        -H "accept: application/json" \
        -H "content-type: application/json" \
        -H "X-API-Key: $PHALA_CLOUD_API_KEY" \
        -H "X-Phala-Version: $PHALA_API_VERSION" \
        -d "{\"hex\":\"$QUOTE_HEX\"}"
    )"

    MEASUREMENT="$(
      printf '%s\n' "$CLOUD_VERIFY_JSON" \
        | "$NODE_BIN" -e 'const fs=require("node:fs"); const text=fs.readFileSync(0,"utf8"); const parsed=JSON.parse(text); const value = parsed?.quote?.body?.mrtd ?? parsed?.raw?.quote?.body?.mrtd ?? parsed?.mrtd ?? ""; process.stdout.write(typeof value === "string" ? value.replace(/^0x/i, "").trim().toLowerCase() : "");'
    )"
  fi
fi

if [[ -z "$MEASUREMENT" || "$MEASUREMENT" == "null" ]]; then
  echo "failed to read measurement from $APP_URL_INPUT" >&2
  exit 1
fi

"$NODE_BIN" - "$ENV_FILE" "$MEASUREMENT" <<'NODE'
const fs = require("node:fs");

const envPath = process.argv[2];
const measurement = process.argv[3];
const source = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const keysToUpdate = new Map([
  ["PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT", measurement],
  ["PROTOTYPE_ATTESTATION_MEASUREMENT", measurement],
]);
const seen = new Set();
const updated = [];

for (const line of source) {
  let replaced = false;
  for (const [key, value] of keysToUpdate.entries()) {
    if (line.startsWith(`${key}=`)) {
      updated.push(`${key}=${value}`);
      seen.add(key);
      replaced = true;
      break;
    }
  }
  if (!replaced && line.length > 0) updated.push(line);
}

for (const [key, value] of keysToUpdate.entries()) {
  if (!seen.has(key)) updated.push(`${key}=${value}`);
}

fs.writeFileSync(envPath, `${updated.join("\n")}\n`, "utf8");
NODE

"$NODE_BIN" - "$ENV_FILE" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const envPath = process.argv[2];
const parsedEnv = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#")) continue;
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) continue;
  parsedEnv[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
}

const result = spawnSync(process.execPath, ["scripts/sync-phala-minimal-inline.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...parsedEnv,
  },
  stdio: "ignore",
});

process.exit(result.status === null ? 1 : result.status);
NODE

echo "Pinned runtime measurement: $MEASUREMENT"
echo "Updated env file: $ENV_FILE"
echo "Rendered compose refreshed: deploy/phala-minimal-prototype/docker-compose.rendered.yml"
