#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/phala-jupyter"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"

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

echo "Deleting CVM: $PHALA_CVM_NAME"
phala cvms delete "$PHALA_CVM_NAME"
