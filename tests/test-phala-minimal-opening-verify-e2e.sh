#!/usr/bin/env bash
set -euo pipefail

APP_URL_INPUT="${1:-${APP_URL:-}}"
if [[ -z "${APP_URL_INPUT}" ]]; then
  echo "usage: APP_URL=https://... bash tests/test-phala-minimal-opening-verify-e2e.sh" >&2
  echo "   or: bash tests/test-phala-minimal-opening-verify-e2e.sh https://..." >&2
  exit 1
fi

APP_URL="${APP_URL_INPUT%/}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PAYLOAD_SCRIPT="$REPO_ROOT/.tmp-opening-payload.ts"
trap 'rm -rf "$TMP_DIR"; rm -f "$PAYLOAD_SCRIPT"' EXIT

cat > "$PAYLOAD_SCRIPT" <<'TS'
import { getMockLightningSnapshot } from "./src/connectors/mockLightningSnapshot.ts";
import { normalizeSnapshot } from "./src/normalization/normalizeSnapshot.ts";
import { applyPrivacyPolicy } from "./src/privacy/applyPrivacyPolicy.ts";

const snapshot = getMockLightningSnapshot();
const normalized = normalizeSnapshot({
  nodeInfo: snapshot.nodeInfo,
  channels: snapshot.channels,
  peers: snapshot.peers,
  graphNodes: snapshot.graphNodes,
  graphEdges: snapshot.graphEdges,
  nodeCentralityMetrics: snapshot.nodeCentralityMetrics,
  missionControlPairs: snapshot.missionControlPairs,
  collectedAt: new Date().toISOString(),
});

const payload = applyPrivacyPolicy(normalized, "feature_only");
process.stdout.write(JSON.stringify({ telemetry: payload }));
TS

(
  cd "$REPO_ROOT"
  pnpm exec tsx "$PAYLOAD_SCRIPT" > "$TMP_DIR/recommend-body.json"
)

echo "opening compact recommend"
curl -sS -X POST "$APP_URL/api/recommend" \
  -H "content-type: application/json" \
  -d @"$TMP_DIR/recommend-body.json" \
  > "$TMP_DIR/recommend-compact.json"

python3 - "$TMP_DIR/recommend-compact.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)

summary = {
    "ok": data.get("ok"),
    "mode": data.get("mode"),
    "signingMode": data.get("signingMode"),
    "openingCount": len((data.get("recommendationSet") or {}).get("channelOpeningRecommendations") or []),
    "firstOpening": ((data.get("recommendationSet") or {}).get("channelOpeningRecommendations") or [None])[0],
    "summary": (data.get("recommendationSet") or {}).get("summary"),
}
print(json.dumps(summary, indent=2))
PY

curl -sS -X POST "$APP_URL/api/recommend?full=true" \
  -H "content-type: application/json" \
  -d @"$TMP_DIR/recommend-body.json" \
  > "$TMP_DIR/recommend-full.json"

curl -sS "$APP_URL/info?full=true" > "$TMP_DIR/info-full.json"
curl -sS "$APP_URL/attestation?full=true" > "$TMP_DIR/attestation-full.json"

python3 - "$TMP_DIR/recommend-full.json" "$TMP_DIR/info-full.json" "$TMP_DIR/attestation-full.json" "$TMP_DIR/verify.json" <<'PY'
import json
import sys

recommend_path, info_path, attestation_path, output_path = sys.argv[1:5]

with open(recommend_path, "r", encoding="utf-8") as fh:
    recommend = json.load(fh)
with open(info_path, "r", encoding="utf-8") as fh:
    info = json.load(fh)
with open(attestation_path, "r", encoding="utf-8") as fh:
    attestation = json.load(fh)

verify_payload = {
    "transformedSnapshot": recommend.get("transformedSnapshot"),
    "recommendationSet": recommend.get("recommendationSet"),
    "arb": recommend.get("arb"),
    "sourceReceipt": recommend.get("sourceReceipt"),
    "liveAppInfo": info,
    "liveAppAttestation": attestation,
}

with open(output_path, "w", encoding="utf-8") as fh:
    json.dump(verify_payload, fh)
PY

echo "opening verify"
curl -sS -X POST "$APP_URL/api/verify" \
  -H "content-type: application/json" \
  -d @"$TMP_DIR/verify.json" \
  > "$TMP_DIR/verify-response.json"

python3 - "$TMP_DIR/verify-response.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)

summary = {
    "ok": data.get("ok"),
    "errors": data.get("errors"),
    "cloudVerification": data.get("cloudVerification"),
    "signerPolicy": data.get("signerPolicy"),
    "attestationPolicy": data.get("attestationPolicy"),
    "sourceReceiptPolicy": data.get("sourceReceiptPolicy"),
    "liveAppEvidencePolicy": data.get("liveAppEvidencePolicy"),
}
print(json.dumps(summary, indent=2))
PY
