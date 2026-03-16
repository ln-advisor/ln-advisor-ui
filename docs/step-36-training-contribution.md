# Step 36: Training Contribution Receipt

Objective:
- attach a provenance-bound receipt whenever privacy-transformed data is explicitly retained for future benchmark/training use

Files:
- `src/api/trainingContribution.ts`
- `src/api/server.ts`
- `scripts/test-step36-training-contribution.ts`

Behavior:
- `retentionMode=none` -> no receipt
- `retentionMode=feature_only_opt_in` -> receipt for retained feature-only artifact
- `retentionMode=banded_opt_in` -> receipt for retained banded artifact

Test:
- `pnpm step36:test`

Artifact:
- `artifacts/step36.training-contribution.json`

Done condition:
- every opted-in retained artifact has a receipt with payload hash, provenance hash, model manifest hash, consent mode, and receipt path
