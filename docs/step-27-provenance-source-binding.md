# Step 27 - Provenance Source Binding

Step 27 binds source-attestation verification receipts directly into source provenance.

## What Was Added

- `src/arb/provenance.ts`
  - Extends execution context with:
    - `sourceVerificationSource`
    - `sourceVerificationHash`
  - Accepts optional `sourceVerificationResult` and hashes it canonically.

- `src/arb/enclave/pipeline.ts`
  - Passes `sourceVerificationResult` into provenance generation so source evidence is included in receipt hashing.

- `scripts/test-step27-provenance-source-binding.ts`
  - Runs pipeline with cloud and app source verification receipts.
  - Verifies source hash binding in provenance context.
  - Verifies ARB `sourceProvenanceHash` changes when source receipt changes.
  - Verifies deterministic output for fixed input/source.

## CLI Test

- `pnpm step27:test`

## JSON Artifact

- `artifacts/step27.provenance-source-binding.json`

## Done Condition

- Source verification receipt is cryptographically bound into provenance, and ARB provenance hash reflects source-evidence changes.
