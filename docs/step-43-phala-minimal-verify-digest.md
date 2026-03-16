# Step 43: Phala Minimal Verify Digest

Objective:
- replace the minimal prototype verify endpoint's shallow `arbVersion` check with deterministic digest verification over the real transformed snapshot and recommendation set

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step43-phala-minimal-verify-digest.mjs`

Behavior:
- `POST /api/verify` now accepts:
  - `transformedSnapshot`
  - `recommendationSet`
  - `arb`
- the endpoint recomputes:
  - `inputHash`
  - `outputHash`
  - `digest`
- the endpoint fails when the recommendation payload or ARB binding fields are tampered with

Test:
- `pnpm step43:test`

Artifact:
- `artifacts/step43.phala-minimal-verify-digest.json`

Done condition:
- the deployed minimal prototype can validate the digest binding between transformed input, scored output, and the payload-bound prototype ARB
