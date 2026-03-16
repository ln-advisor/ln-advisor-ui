# Step 37: Cohort Features

Objective:
- derive a benchmark-ready, privacy-safe cohort feature export from `feature_only` node state

Files:
- `src/scoring/cohortFeatures.ts`
- `scripts/test-step37-cohort-features.ts`

Output:
- node-level bands
- channel-level bands keyed by `channelRef`
- peer-level bands keyed by `peerRef`

Test:
- `pnpm step37:test`

Artifact:
- `artifacts/step37.cohort-features.json`

Done condition:
- deterministic cohort export exists and contains only ref-based bands, not exact balances, fees, or revenues
