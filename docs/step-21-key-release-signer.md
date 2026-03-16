# Step 21 - Key-Release-Backed Signer

Step 21 moves ARB signing away from direct `devSigningKey` usage by adding a policy-gated signing key release path.

## What Was Added

- `src/arb/enclave/signingKeyProvider.ts`
  - Defines signer key release interface:
    - `SigningKeyProvider`
    - `ReleasedSigningKey`
  - Adds `StaticKeyringSigningKeyProvider` for deterministic local tests.

- `src/arb/enclave/pipeline.ts`
  - `devSigningKey` is now optional.
  - Adds optional `signingKeyProvider`.
  - When key-release policy grants a `keyId` and a provider is configured, pipeline releases signing key from provider.
  - Rejects run when no direct key and no releasable key is available.
  - Extends run summary key-release details with `keySource`.

- `scripts/test-step21-key-release-signer.ts`
  - Runs enclave pipeline with:
    - `tee_verified` Phala provider
    - strict key-release policy
    - released signer key from provider
  - Verifies ARB.
  - Verifies rejection when signer provider is missing.
  - Verifies deterministic output.

## CLI Test

- `pnpm step21:test`

Optional custom artifact paths:

- `pnpm tsx scripts/test-step21-key-release-signer.ts <cvm-info-path> <cli-attestation-path>`

## JSON Artifact

- `artifacts/step21.key-release-signer.json`

## Done Condition

- Signing trust root is policy-gated key release under verified attestation, and pipeline refuses to sign without releasable key material.
