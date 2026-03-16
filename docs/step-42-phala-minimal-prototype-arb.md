# Step 42: Phala Minimal Prototype ARB

Objective:
- replace the minimal prototype recommend endpoint's fixed ARB with a deterministic payload-bound digest over the real transformed snapshot and recommendation set

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step42-phala-minimal-prototype-arb.mjs`

Behavior:
- `POST /api/recommend` now returns:
  - `signingMode: prototype_digest`
  - `arb.inputHash`
  - `arb.outputHash`
  - `arb.digest`
- the ARB remains a prototype and is not yet a real signature
- the ARB is deterministic for identical input telemetry

Test:
- `pnpm step42:test`

Artifact:
- `artifacts/step42.phala-minimal-prototype-arb.json`

Done condition:
- the deployed minimal prototype can return a payload-bound prototype ARB whose hashes and digest are stable and derived from the actual transformed input and scored output
