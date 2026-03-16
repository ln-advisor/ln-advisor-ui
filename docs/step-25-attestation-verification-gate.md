# Step 25 - Attestation Verification Gate

Step 25 adds a strict gate that consumes source verification output (from Step 23/24) before trust decisions continue.

## What Was Added

- `src/arb/attestationVerificationGate.ts`
  - Introduces `evaluateAttestationVerificationGate(...)`.
  - Enforces policy checks:
    - source verification presence
    - quote verified by Phala API
    - allowed verification source list
    - app compose RTMR binding (for app source)
    - reportData match when expected
    - ARB quote format alignment with source verification

- `scripts/test-step25-attestation-verification-gate.ts`
  - Deterministic mock test that validates:
    - cloud source pass
    - app source pass
    - app reportData mismatch rejection
    - source restriction rejection
    - ARB/source quote format mismatch rejection

## CLI Test

- `pnpm step25:test`

## JSON Artifact

- `artifacts/step25.attestation-verification-gate.json`

## Done Condition

- Strict source-verification gate is enforceable and rejects mismatched evidence before downstream trust actions.
