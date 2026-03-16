#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/phala-jupyter"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"

if ! command -v phala >/dev/null 2>&1; then
  echo "phala CLI not found. Install with: npm i -g phala" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install with: sudo apt-get install -y jq" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "Create it from: $DEPLOY_DIR/.env.example" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${PHALA_CVM_NAME:?PHALA_CVM_NAME is required in $ENV_FILE}"

mkdir -p "$ROOT_DIR/artifacts"

CVM_JSON_PATH="$ROOT_DIR/artifacts/phala-jupyter.cvm.json"
CLI_ATTEST_PATH="$ROOT_DIR/artifacts/phala-jupyter.attestation.cli.json"
HTTP_INFO_PATH="$ROOT_DIR/artifacts/phala-jupyter.info.http.json"
HTTP_ATTEST_PATH="$ROOT_DIR/artifacts/phala-jupyter.attestation.http.json"
HTTP_ERROR_PATH="$ROOT_DIR/artifacts/phala-jupyter.http-attestation.error.txt"

phala cvms get "$PHALA_CVM_NAME" --json >"$CVM_JSON_PATH"
APP_ID="$(jq -r '.app_id // .appId // .cvm_id // .id // empty' "$CVM_JSON_PATH")"
APP_URL="$(jq -r '.public_urls[0].app // .publicUrls[0].app // .endpoints[0].app // .url // empty' "$CVM_JSON_PATH")"

if [[ -z "$APP_URL" && -n "$APP_ID" && -n "${PHALA_DSTACK_HOST_SUFFIX:-}" ]]; then
  APP_URL="https://${APP_ID}-8080.${PHALA_DSTACK_HOST_SUFFIX}/"
fi

echo "Running CLI attestation fetch..."
if phala cvms attestation "$PHALA_CVM_NAME" --json >"$CLI_ATTEST_PATH" 2>/dev/null; then
  :
elif phala cvms attestation --cvm-id "$PHALA_CVM_NAME" --json >"$CLI_ATTEST_PATH" 2>/dev/null; then
  :
elif [[ -n "$APP_ID" ]] && phala cvms attestation --cvm-id "$APP_ID" --json >"$CLI_ATTEST_PATH" 2>/dev/null; then
  :
else
  echo "Failed to get attestation via CLI command variants." >&2
  exit 1
fi

echo "Detected app id: ${APP_ID:-<empty>}"
echo "Detected app url: ${APP_URL:-<empty>}"

if [[ -n "$APP_URL" ]]; then
  echo "Fetching app /info and /attestation..."
  if curl -fsSL "${APP_URL%/}/info" >"$HTTP_INFO_PATH" && curl -fsSL "${APP_URL%/}/attestation" >"$HTTP_ATTEST_PATH"; then
    echo "HTTP attestation endpoints fetched successfully."
    rm -f "$HTTP_ERROR_PATH"
  else
    echo "HTTP attestation endpoints are not available on this app image. CLI attestation is still valid."
    {
      echo "App URL: ${APP_URL}"
      echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "Reason: GET /info or GET /attestation returned non-success (common for plain Jupyter images)."
    } >"$HTTP_ERROR_PATH"
  fi
else
  echo "Skipping HTTP attestation fetch; app URL not available."
fi

echo
echo "Saved artifacts:"
echo "- $CVM_JSON_PATH"
echo "- $CLI_ATTEST_PATH"
if [[ -f "$HTTP_INFO_PATH" ]]; then
  echo "- $HTTP_INFO_PATH"
fi
if [[ -f "$HTTP_ATTEST_PATH" ]]; then
  echo "- $HTTP_ATTEST_PATH"
fi
if [[ -f "$HTTP_ERROR_PATH" ]]; then
  echo "- $HTTP_ERROR_PATH"
fi
