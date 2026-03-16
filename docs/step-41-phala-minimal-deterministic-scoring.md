# Step 41: Phala Minimal Deterministic Scoring

Objective:
- replace the minimal prototype recommend endpoint's fixed payload with one real deterministic fee-scoring pass over feature-only transformed telemetry

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step41-phala-minimal-deterministic-scoring.mjs`

Behavior:
- `POST /api/recommend` now accepts:
  - `telemetry.nodeAlias`
  - `telemetry.channels[]`
- the endpoint internally derives `feature_only` transformed state
- the endpoint returns:
  - `modelVersion: prototype-fee-forward-v1`
  - `transformedSnapshot`
  - deterministic `feeRecommendations`
  - summary counts for `raise`, `lower`, and `hold`

Test:
- `pnpm step41:test`

Artifact:
- `artifacts/step41.phala-minimal-deterministic-scoring.json`

Done condition:
- the deployed minimal prototype can produce stable fee recommendations from input telemetry without exposing raw channel ids or balances in the scored output
