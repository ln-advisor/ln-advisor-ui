# Step 23 - Attestation Source Selection

Step 23 adds explicit selection of attestation verification source.

## What Was Added

- `src/tee/phala/attestationSource.ts`
  - Introduces `verifyPhalaAttestationBySource(...)`.
  - Supported sources:
    - `cloud_cvm_attestation`
    - `app_http_attestation`
  - Returns unified verification result schema with source-specific checks.

- `src/tee/phala/index.ts`
  - Exports source-selection verifier.

- `scripts/test-step23-attestation-source-selection.ts`
  - Runs deterministic mock test covering:
    - cloud source pass
    - app source pass
    - app source expected mismatch failure
  - Verifies API version header is included in cloud requests.

## CLI Test

- `pnpm step23:test`

## JSON Artifact

- `artifacts/step23.attestation-source-selection.json`

## Done Condition

- Both attestation verification sources are runnable with unified output, and policy-relevant mismatch failures are observable in the selected source path.
