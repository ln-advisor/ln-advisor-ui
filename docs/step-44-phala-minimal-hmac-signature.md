# Step 44: Phala Minimal HMAC Signature

Objective:
- replace the digest-only prototype ARB with a keyed HMAC signature over the deterministic digest so the verifier can check origin under a shared signing secret

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step44-phala-minimal-hmac-signature.mjs`

Behavior:
- `POST /api/recommend` now returns:
  - `signingMode: prototype_hmac`
  - `arb.signature.algorithm`
  - `arb.signature.keyId`
  - `arb.signature.value`
- `POST /api/verify` now also validates the HMAC signature
- the signature key is provided by `PROTOTYPE_ARB_SIGNING_KEY`

Test:
- `pnpm step44:test`

Artifact:
- `artifacts/step44.phala-minimal-hmac-signature.json`

Done condition:
- the deployed minimal prototype can sign payload-bound ARBs with HMAC and reject bundles whose signature was tampered with
