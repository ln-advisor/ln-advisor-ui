#!/usr/bin/env bash
set -euo pipefail

APP_URL_INPUT="${1:-${APP_URL:-}}"
if [[ -z "${APP_URL_INPUT}" ]]; then
  echo "usage: APP_URL=https://... bash tests/test-phala-minimal-channel-verify-e2e.sh" >&2
  echo "   or: bash tests/test-phala-minimal-channel-verify-e2e.sh https://..." >&2
  exit 1
fi

APP_URL="${APP_URL_INPUT%/}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TELEMETRY_PAYLOAD='{"telemetry":{"nodeAlias":"smoke-node","channels":[{"channelId":"100x1x0","peerPubkey":"02aaaa","active":true,"localBalanceSat":800000,"remoteBalanceSat":200000,"outboundFeePpm":120,"forwardCount":9,"revenueSat":450,"failedForwardCount":0}]}}'

echo "compact recommend"
curl -sS -X POST "$APP_URL/api/recommend" \
  -H "content-type: application/json" \
  -d "$TELEMETRY_PAYLOAD" \
  | tee "$TMP_DIR/recommend-compact.json" \
  | jq '{ok, mode, signingMode, digest: .arb.digest, quote_present:(.arb.attestation.quote != null), quote_preview:.arb.attestation.quote_preview, quote_length:.arb.attestation.quote_length, summary:.recommendationSet.summary}'

curl -sS -X POST "$APP_URL/api/recommend?full=true" \
  -H "content-type: application/json" \
  -d "$TELEMETRY_PAYLOAD" \
  > "$TMP_DIR/recommend-full.json"

curl -sS "$APP_URL/info?full=true" > "$TMP_DIR/info-full.json"
curl -sS "$APP_URL/attestation?full=true" > "$TMP_DIR/attestation-full.json"

jq -n \
  --slurpfile rec "$TMP_DIR/recommend-full.json" \
  --slurpfile info "$TMP_DIR/info-full.json" \
  --slurpfile att "$TMP_DIR/attestation-full.json" \
  '{
    transformedSnapshot: $rec[0].transformedSnapshot,
    recommendationSet: $rec[0].recommendationSet,
    arb: $rec[0].arb,
    sourceReceipt: $rec[0].sourceReceipt,
    liveAppInfo: $info[0],
    liveAppAttestation: $att[0]
  }' > "$TMP_DIR/verify.json"

echo "verify"
curl -sS -X POST "$APP_URL/api/verify" \
  -H "content-type: application/json" \
  -d @"$TMP_DIR/verify.json" \
  | tee "$TMP_DIR/verify-response.json" \
  | jq '{ok, errors, cloudVerification, signerPolicy, attestationPolicy, sourceReceiptPolicy, liveAppEvidencePolicy}'

python3 - "$TMP_DIR/verify.json" "$TMP_DIR/verify-bad.json" <<'PY'
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as fh:
    data = json.load(fh)

quote = data["liveAppAttestation"]["quote"]
if not isinstance(quote, str) or len(quote) == 0:
    raise SystemExit("liveAppAttestation.quote missing")

first = quote[0].lower()
replacement = "1" if first == "0" else "0"
data["liveAppAttestation"]["quote"] = replacement + quote[1:]

with open(dst, "w", encoding="utf-8") as fh:
    json.dump(data, fh)
PY

echo "verify tampered"
curl -sS -X POST "$APP_URL/api/verify" \
  -H "content-type: application/json" \
  -d @"$TMP_DIR/verify-bad.json" \
  | jq '{ok, errors}'
