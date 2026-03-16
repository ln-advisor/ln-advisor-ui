#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/phala-minimal-prototype"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.rendered.yml"

if ! command -v phala >/dev/null 2>&1; then
  echo "phala CLI not found. Install with: npm i -g phala" >&2
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

node "$ROOT_DIR/scripts/sync-phala-minimal-inline.mjs"

if [[ "${PROTOTYPE_ATTESTATION_SOURCE:-}" == "dstack_runtime" && "${PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT:-}" == "runtime-discovery-placeholder" ]]; then
  echo "warning: PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT is still set to runtime-discovery-placeholder" >&2
  echo "         pin the real runtime measurement after discovery with:" >&2
  echo "         APP_URL=https://... bash scripts/phala-minimal-pin-runtime-measurement.sh \"$ENV_FILE\"" >&2
fi

echo "Deploying minimal prototype CVM: $PHALA_CVM_NAME"
phala deploy -c "$COMPOSE_FILE" -n "$PHALA_CVM_NAME"

echo
echo "Fetching CVM status..."
phala cvms get "$PHALA_CVM_NAME"
