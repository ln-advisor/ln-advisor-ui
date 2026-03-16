# Step 28 - Verify Source Binding

Step 28 adds verifier-side validation that provenance is bound to the exact source verification receipt.

## What Was Added

- `src/arb/verifySourceVerificationBinding.ts`
  - Adds `verifySourceVerificationBinding(...)`.
  - Verifies that:
    - provenance source/hash fields are internally consistent
    - provided source verification source matches provenance source
    - provided source verification hash matches provenance source hash
    - required source verification is present (when configured)

- `scripts/test-step28-verify-source-binding.ts`
  - Runs pipeline with source verification evidence.
  - Verifies:
    - binding pass with correct source receipt
    - binding fail with wrong source receipt
    - binding fail when missing required source receipt

## CLI Test

- `pnpm step28:test`

## JSON Artifact

- `artifacts/step28.verify-source-binding.json`

## Done Condition

- Verifier enforces exact source-verification receipt binding against provenance, rejecting mismatched or missing receipts.
