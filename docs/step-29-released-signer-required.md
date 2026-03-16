# Step 29 - Released Signer Required

Step 29 adds a strict pipeline mode that forbids direct dev key signing and requires released signer key material.

## What Was Added

- `src/arb/enclave/pipeline.ts`
  - Adds `requireReleasedSigningKey` option.
  - In release-required mode:
    - signing must come from `signingKeyProvider`
    - `keyReleasePolicy` must provide a releasable `keyId`
    - direct `devSigningKey` fallback is rejected
  - Exposes in run summary:
    - `releasedSignerRequired`
    - `releasedSignerUsed`

- `scripts/test-step29-released-signer-required.ts`
  - Verifies:
    - pass when released signer is used
    - reject when provider is missing
    - reject when keyId/key-release path is missing
    - deterministic output for fixed inputs

## CLI Test

- `pnpm step29:test`

## JSON Artifact

- `artifacts/step29.released-signer-required.json`

## Done Condition

- Pipeline can run in released-signer-only mode where signing is possible only via key-release provider and direct dev-key fallback is blocked.
