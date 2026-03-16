# Step 26 - Pipeline Source Verification Gate

Step 26 integrates the attestation verification gate into the enclave pipeline, so source verification is enforced before signing.

## What Was Added

- `src/arb/enclave/pipeline.ts`
  - Adds optional pipeline inputs:
    - `sourceVerificationResult`
    - `attestationVerificationGatePolicy`
  - Evaluates source verification gate before key-release/signing.
  - Rejects run if gate fails.
  - Exposes gate status in run summary (`sourceVerificationGate`).

- `scripts/test-step26-pipeline-source-verification-gate.ts`
  - Deterministic integration test for pipeline-level enforcement:
    - verified cloud source passes
    - missing source verification is rejected
    - disallowed source is rejected
    - output remains deterministic for fixed inputs

## CLI Test

- `pnpm step26:test`

## JSON Artifact

- `artifacts/step26.pipeline-source-verification-gate.json`

## Done Condition

- Source attestation verification is now an enforceable pipeline gate prior to signing, with explicit reject behavior for missing or disallowed sources.
