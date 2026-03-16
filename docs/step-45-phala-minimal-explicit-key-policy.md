# Step 45: Phala Minimal Explicit-Key Policy

Objective:
- fail closed when the prototype signer is configured to require an explicit non-default signing key and expose signer key-source metadata in the ARB

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `scripts/test-step45-phala-minimal-explicit-key-policy.mjs`

Behavior:
- `PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY=true` blocks `/api/recommend` if the service is still using the default prototype signing key
- `arb.signature.keySource` is now included and must match the verifier expectation
- with an explicit signing key set, recommendation and verify continue to work

Test:
- `pnpm step45:test`

Artifact:
- `artifacts/step45.phala-minimal-explicit-key-policy.json`

Done condition:
- the deployed minimal prototype can enforce an explicit-key policy and identify the signer key source in the ARB
