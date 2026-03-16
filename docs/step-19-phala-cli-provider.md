# Step 19 - Phala CLI-Backed Enclave Provider

Step 19 replaces synthetic enclave metadata input with real Phala CLI artifacts as the attestation source for the enclave pipeline.

## What Was Added

- `src/arb/enclave/phalaCliProvider.ts`
  - Adds `PhalaCliEnclaveProvider` (`executionMode = tee_verified`).
  - Loads and parses:
    - `artifacts/phala-jupyter.cvm.json`
    - `artifacts/phala-jupyter.attestation.cli.json`
  - Builds deterministic attestation evidence from real Phala identity/runtime fields.
  - Exposes `createPhalaCliEnclaveProviderFromArtifacts(...)`.
  - Initial Step 19 flow established provider wiring; quote format is upgraded in Step 20.

- `scripts/test-step19-phala-provider-from-cli.ts`
  - Runs the enclave boundary pipeline using mock Lightning snapshot + Phala CLI-backed provider.
  - Verifies produced ARB (`verifyArb`), checks provider/execution-mode bindings, and enforces deterministic output for fixed inputs.
  - Writes test artifact.

- `package.json`
  - Adds `step19:test` script.

## CLI Test

- `pnpm step19:test`

Optional custom artifact paths:

- `pnpm tsx scripts/test-step19-phala-provider-from-cli.ts <cvm-info-path> <cli-attestation-path>`

## JSON Artifact

- `artifacts/step19.phala-provider-from-cli.json`

## Done Condition

- Enclave pipeline consumes Phala CLI attestation artifacts and produces a `tee_verified` ARB that:
  - passes ARB verification, and
  - is deterministic for fixed inputs.
