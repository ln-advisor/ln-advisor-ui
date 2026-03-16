# Step 22 - Strict Attestation Policy

Step 22 adds production-style attestation policy enforcement for ARB verification.

## What Was Added

- `src/arb/attestationPolicy.ts`
  - Extends `AttestationPolicy` with:
    - `allowedMeasurements`
    - `allowedQuoteFormats`
  - Enforces provider, measurement, and quote-format allow-lists during policy evaluation.

- `scripts/test-step22-strict-attestation-policy.ts`
  - Produces ARB from Phala CLI-backed provider.
  - Verifies ARB signature/hashes.
  - Evaluates strict policy that must pass.
  - Evaluates three negative policies that must fail:
    - wrong measurement
    - wrong quote format
    - wrong provider

## CLI Test

- `pnpm step22:test`

Optional custom artifact paths:

- `pnpm tsx scripts/test-step22-strict-attestation-policy.ts <cvm-info-path> <cli-attestation-path>`

## JSON Artifact

- `artifacts/step22.strict-attestation-policy.json`

## Done Condition

- Only ARBs matching all strict attestation constraints (provider + measurement + quote format) are accepted.
