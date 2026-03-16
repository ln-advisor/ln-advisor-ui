# Step 40: Phala Minimal Privacy Transform

Objective:
- replace the minimal prototype snapshot endpoint's fixed payload with one real deterministic privacy transform over a small telemetry schema

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step40-phala-minimal-privacy-transform.mjs`

Behavior:
- `POST /api/snapshot` now accepts:
  - `telemetry.nodeAlias`
  - `telemetry.channels[]`
  - `privacyMode` of `feature_only` or `banded`
- the endpoint returns transformed channel refs and either:
  - feature-only ratios/derived metrics, or
  - banded privacy buckets

Test:
- `pnpm step40:test`

Artifact:
- `artifacts/step40.phala-minimal-privacy-transform.json`

Done condition:
- the deployed minimal prototype can be upgraded to a real protected privacy-transform endpoint without adding the full advisor pipeline or leaking exact balances and identifiers
