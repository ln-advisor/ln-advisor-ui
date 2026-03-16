#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/phala-jupyter"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

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

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${PHALA_CVM_NAME:?PHALA_CVM_NAME is required in $ENV_FILE}"
: "${JUPYTER_TOKEN:?JUPYTER_TOKEN is required in $ENV_FILE}"

echo "Deploying CVM: $PHALA_CVM_NAME"
phala deploy -c "$COMPOSE_FILE" -n "$PHALA_CVM_NAME" -e "TOKEN=$JUPYTER_TOKEN"

echo "Fetching CVM status..."
phala cvms get "$PHALA_CVM_NAME"

mkdir -p "$ROOT_DIR/artifacts"
CVM_JSON_PATH="$ROOT_DIR/artifacts/phala-jupyter.cvm.json"
phala cvms get "$PHALA_CVM_NAME" --json >"$CVM_JSON_PATH"

APP_ID="$(jq -r '.app_id // .appId // .cvm_id // .id // empty' "$CVM_JSON_PATH")"
APP_URL="$(jq -r '.public_urls[0].app // .publicUrls[0].app // .endpoints[0].app // .url // empty' "$CVM_JSON_PATH")"

if [[ -z "$APP_URL" && -n "$APP_ID" && -n "${PHALA_DSTACK_HOST_SUFFIX:-}" ]]; then
  APP_URL="https://${APP_ID}-8080.${PHALA_DSTACK_HOST_SUFFIX}/"
fi

echo
echo "Saved CVM JSON: $CVM_JSON_PATH"
echo "Detected app id: ${APP_ID:-<empty>}"
echo "Detected app url: ${APP_URL:-<empty>}"
echo
echo "Export these in your shell:"
if [[ -n "$APP_ID" ]]; then
  echo "export PHALA_CVM_ID='$APP_ID'"
fi
if [[ -n "$APP_URL" ]]; then
  echo "export PHALA_APP_BASE_URL='${APP_URL}'"
fi
echo
echo "Next: run attestation helper"
echo "bash scripts/phala-jupyter-attestation.sh '$ENV_FILE'"
