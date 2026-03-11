# Step 16 - Key Release Gate

Step 16 enforces key release gating before ARB signing.

## What Was Added

- `src/arb/keyReleasePolicy.ts`
  - Defines `KeyReleasePolicy` and `evaluateKeyReleasePolicy`.
  - Enforces:
    - minimum execution mode
    - allowed provider IDs
    - allowed enclave measurements
    - allowed quote formats

- `src/arb/enclave/pipeline.ts`
  - Added optional `keyReleasePolicy` input.
  - Evaluates policy after attestation and before signing.
  - Denies signing when policy fails (`Key release denied: ...`).
  - Emits key release result in run summary.

## Step 16 Test + Artifact

- CLI test:
  - `pnpm tsx scripts/test-step16-key-release-gate.ts`
- JSON artifact:
  - `artifacts/step16.key-release-gate.json`
- Pass condition:
  - `tee_verified` run passes key release and signs successfully.
  - `tee_simulated` run is denied before signing by the same policy.
  - Verified run remains deterministic for fixed inputs.
