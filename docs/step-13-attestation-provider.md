# Step 13 - Attestation Provider Boundary

Step 13 introduces an explicit enclave-provider interface and wires attestation evidence into ARB and provenance.

## What Was Added

- `src/arb/attestation.ts`
  - Defines `ArbAttestationEvidence` (`arb-attestation-evidence-v1`).

- `src/arb/enclave/provider.ts`
  - Defines `EnclaveProvider` interface.
  - Adds `LocalDevEnclaveProvider` for deterministic local attestation evidence generation.

- `src/arb/buildArb.ts`
  - `BuildArbOptions` now accepts optional `attestation`.
  - `ArbBundle` can now carry `attestation`.

- `src/arb/provenance.ts`
  - `SourceProvenanceReceipt` now includes `executionContext`:
    - execution mode
    - enclave provider id
    - attestation hash link

- `src/arb/verifyArb.ts`
  - Validates attestation schema/fields when attestation is present.
  - Includes attestation in digest recomputation when present.

- `src/arb/enclave/pipeline.ts`
  - Requests attestation evidence from provider before signing.
  - Links provenance execution context to attestation.
  - Passes attestation into ARB signing.

## Step 13 Test + Artifact

- CLI test:
  - `pnpm tsx scripts/test-step13-attestation.ts`
- JSON artifact:
  - `artifacts/step13.attestation-boundary.json`
- Pass condition:
  - ARB includes attestation evidence.
  - Provenance execution context links to that attestation.
  - ARB verification passes.
  - Re-running with identical fixed inputs remains deterministic.
