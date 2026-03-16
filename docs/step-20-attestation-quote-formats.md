# Step 20 - Real Attestation Quote Formats

Step 20 upgrades ARB attestation handling from simulated-only quote formats to include real TDX quote format support.

## What Was Added

- `src/arb/attestation.ts`
  - Introduces `ArbAttestationQuoteFormat` union:
    - `simulated_quote`
    - `tdx_quote`

- `src/arb/verifyArb.ts`
  - Extends attestation validation to accept both supported quote formats.

- `src/arb/enclave/phalaCliProvider.ts`
  - Resolves and emits real quote format for Phala CLI artifacts.
  - Uses `tdx_quote` when quote data is present (or explicit format if provided).

- `scripts/test-step20-attestation-quote-formats.ts`
  - Validates end-to-end behavior:
    - Phala provider emits `tdx_quote`.
    - ARB verification passes with `tdx_quote`.
    - `tdx_quote`-only key release policy grants signing.
    - `simulated_quote`-only policy rejects the same attestation.
    - deterministic ARB output for fixed inputs.

## CLI Test

- `pnpm step20:test`

Optional custom artifact paths:

- `pnpm tsx scripts/test-step20-attestation-quote-formats.ts <cvm-info-path> <cli-attestation-path>`

## JSON Artifact

- `artifacts/step20.attestation-quote-formats.json`

## Done Condition

- Real `tdx_quote` attestation is accepted by ARB verification and enforceable by key-release policy, with deterministic output for fixed inputs.
