#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
OUT_DIR="artifacts/api"

mkdir -p "${OUT_DIR}"

echo "POST ${BASE_URL}/api/snapshot"
curl -sS -X POST "${BASE_URL}/api/snapshot" \
  -H "Content-Type: application/json" \
  -d '{"mode":"mock"}' \
  > "${OUT_DIR}/snapshot.json"

echo "POST ${BASE_URL}/api/recommend"
curl -sS -X POST "${BASE_URL}/api/recommend" \
  -H "Content-Type: application/json" \
  -d '{"mode":"mock","privacyMode":"feature_only"}' \
  > "${OUT_DIR}/recommend.json"

echo "POST ${BASE_URL}/api/verify"
curl -sS -X POST "${BASE_URL}/api/verify" \
  -H "Content-Type: application/json" \
  -d '{"arbPath":"artifacts/recommendation-bundle.arb.json","sourceProvenancePath":"artifacts/source-provenance.json"}' \
  > "${OUT_DIR}/verify.json"

echo "Saved API outputs:"
echo "- ${OUT_DIR}/snapshot.json"
echo "- ${OUT_DIR}/recommend.json"
echo "- ${OUT_DIR}/verify.json"

