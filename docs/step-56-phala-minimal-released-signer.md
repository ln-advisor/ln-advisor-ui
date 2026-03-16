# Step 56 - Phala Minimal Released Signer

Step 56 upgrades the minimal Phala prototype from direct env-key signing to a policy-gated released-signer path.

## What Was Added

- `deploy/phala-minimal-prototype/server.mjs`
  - Adds `released_keyring` signer provider type.
  - Requires:
    - `PROTOTYPE_RELEASED_SIGNER_KEY_ID`
    - `PROTOTYPE_RELEASED_SIGNER_KEY_PROVIDER_ID`
    - `PROTOTYPE_RELEASED_SIGNER_KEYRING_JSON`
  - Applies released-signer policy before signing:
    - minimum execution mode
    - attestation requirement
    - allowed provider ids
    - allowed measurements
    - allowed quote formats
  - Exposes released-signer metadata in:
    - `/health`
    - `/info`
    - `/api/verify`
  - Returns `signingMode: "released_signer"` when this path is active.

- `scripts/sync-phala-minimal-inline.mjs`
  - Renders the new `PROTOTYPE_RELEASED_SIGNER_*` envs into compose.

- `deploy/phala-minimal-prototype/.env.example`
  - Documents released-signer envs for local/live deploys.

- `scripts/test-step56-phala-minimal-released-signer.mjs`
  - Verifies:
    - released signer path signs successfully
    - verify passes with released signer metadata
    - attestation measurement mismatch fails closed
    - rendered compose contains the new released-signer envs

## CLI Test

- `pnpm step56:test`

## Done Condition

- The minimal Phala prototype can sign only after policy-gated key release, and it fails closed when attestation evidence does not satisfy the released-signer policy.
