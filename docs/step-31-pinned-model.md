# Step 31 - Pinned Model Manifest

Step 31 upgrades the deterministic scorer into a pinned Props-style model manifest.

## What Was Added

- `src/scoring/modelManifest.ts`
  - Defines `PinnedModelManifest`.
  - Defines supported pinning modes:
    - `exact_manifest_pinned`
    - `service_pinned_private_model`
  - Exposes canonical hashing helpers and the default manifest for `fee-forward-v1`.

- `src/arb/provenance.ts`
  - Binds pinned-model fields into `executionContext`:
    - `modelManifestHash`
    - `modelPinningMode`

- `src/arb/buildArb.ts`
  - Adds ARB-level model binding:
    - `modelManifestHash`
    - `modelPinningMode`

- `src/arb/verifyArb.ts`
  - Validates ARB model binding fields.
  - Checks provenance model binding matches the ARB.

- `src/arb/enclave/pipeline.ts`
  - Threads pinned model manifest through provenance and ARB signing.

- `scripts/test-step31-pinned-model.ts`
  - Verifies:
    - manifest hash is bound into provenance
    - manifest hash is bound into ARB
    - output is deterministic
    - tampered model binding is rejected

## CLI Test

- `pnpm step31:test`

## JSON Artifact

- `artifacts/step31.pinned-model.json`

## Done Condition

- The recommendation pipeline is now pinned to a canonical model manifest, and verification rejects tampering with that model binding.
