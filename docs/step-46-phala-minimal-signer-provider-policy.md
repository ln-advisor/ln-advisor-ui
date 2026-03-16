# Step 46: Phala Minimal Signer Provider Policy

Objective:
- add signer-provider metadata to the prototype ARB and enforce an allowed signer provider id during verification

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step46-phala-minimal-signer-provider-policy.mjs`

Behavior:
- `arb.signature` now includes:
  - `signerProviderId`
  - `signerProviderType`
- `POST /api/verify` now enforces:
  - allowed signer provider id
  - expected signer provider type
- the allowed signer provider id is controlled by:
  - `PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID`

Test:
- `pnpm step46:test`

Artifact:
- `artifacts/step46.phala-minimal-signer-provider-policy.json`

Done condition:
- the deployed minimal prototype can bind ARBs to a signer-provider identity and reject bundles signed by a disallowed provider id
