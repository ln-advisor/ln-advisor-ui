# Step 14 - TEE Simulated Execution Mode

Step 14 introduces a `tee_simulated` enclave provider path while keeping execution local and deterministic.

## What Was Added

- `src/arb/enclave/provider.ts`
  - Added `SimulatedTeeEnclaveProvider`.
  - Provider id: `simulated-tee-enclave-provider`.
  - Execution mode: `tee_simulated`.
  - Emits deterministic simulated quote + measurement.

## Existing Pipeline Behavior Used

- `src/arb/enclave/pipeline.ts` already maps:
  - `tee_simulated` -> provenance execution context `tee_candidate`
  - `tee_verified` -> `tee_verified`
  - `local_dev` -> `host_local`

## Step 14 Test + Artifact

- CLI test:
  - `pnpm tsx scripts/test-step14-tee-simulated.ts`
- JSON artifact:
  - `artifacts/step14.tee-simulated.json`
- Pass condition:
  - ARB attestation execution mode is `tee_simulated`.
  - Provenance execution context is `tee_candidate`.
  - ARB verification passes.
  - Re-run with fixed inputs produces identical output.
