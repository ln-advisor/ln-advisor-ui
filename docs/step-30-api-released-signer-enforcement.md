# Step 30 - API Released-Signer Enforcement

Step 30 adds strict server-side enforcement so `POST /api/recommend` can run in released-signer-only mode.

## What Was Added

- `src/api/server.ts`
  - Adds `API_REQUIRE_RELEASED_SIGNER` mode switch.
  - Adds fail-closed env config parsing for released signer mode:
    - `API_RELEASED_SIGNER_KEY_ID`
    - `API_RELEASED_SIGNER_KEYRING_JSON`
    - optional policy/provider envs
  - In strict mode, `/api/recommend` now runs through `runEnclaveBoundaryPipeline` with:
    - `requireReleasedSigningKey: true`
    - `keyReleasePolicy`
    - `signingKeyProvider`
    - selected enclave provider (`verified_tee`, `simulated_tee`, `local_dev`, or `phala_cli`)
  - Response now includes:
    - `signingMode` (`dev_key` or `released_signer`)
    - `enclaveRunSummary` when strict mode is used.

- `scripts/test-step30-api-released-signer-enforcement.ts`
  - Verifies:
    - strict mode rejects missing signer config (fail-closed)
    - strict mode succeeds with valid key-release signer config
    - resulting ARB verifies with released key and fails with decoy key
    - deterministic ARB output for fixed inputs

## CLI Test

- `pnpm step30:test`

## JSON Artifact

- `artifacts/step30.api-released-signer-enforcement.json`

## Done Condition

- `/api/recommend` can enforce released-signer-only mode, rejecting missing release config and producing bundles signed only through the configured key-release provider path.
