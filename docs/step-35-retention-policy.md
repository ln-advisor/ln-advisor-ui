# Step 35: Retention Policy

Objective:
- keep the API stateless by default and only retain privacy-transformed data when explicitly opted in

Files:
- `src/api/retention.ts`
- `src/api/server.ts`
- `scripts/test-step35-retention-policy.ts`

Modes:
- `none`
- `feature_only_opt_in`
- `banded_opt_in`

Test:
- `pnpm step35:test`

Artifact:
- `artifacts/step35.retention-policy.json`

Done condition:
- default API recommend flow retains nothing
- opt-in retention persists only `feature_only` or `banded` artifacts under `artifacts/retention/`
