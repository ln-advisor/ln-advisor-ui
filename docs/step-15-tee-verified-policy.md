# Step 15 - TEE Verified Policy Gate

Step 15 introduces a strict attestation policy check that can enforce `tee_verified` execution mode.

## What Was Added

- `src/arb/enclave/provider.ts`
  - Added `VerifiedTeeEnclaveProvider`.
  - Provider id: `verified-tee-enclave-provider`.
  - Execution mode: `tee_verified`.

- `src/arb/attestationPolicy.ts`
  - Added policy engine:
    - minimum execution mode enforcement
    - allowed provider enforcement
    - quote hash integrity check
    - provenance linkage checks (provider/mode/attestation hash)

## Step 15 Test + Artifact

- CLI test:
  - `pnpm tsx scripts/test-step15-tee-verified-policy.ts`
- JSON artifact:
  - `artifacts/step15.tee-verified-policy.json`
- Pass condition:
  - ARB generated with `tee_verified` provider passes strict policy.
  - ARB generated with `tee_simulated` provider fails that same strict policy.
