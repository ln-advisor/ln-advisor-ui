# Step 33: Trust-Aware Verify

Objective:
- upgrade `POST /api/verify` from structural ARB checks only to a trust-aware verifier that can also enforce attestation policy and source-binding rules

Files:
- `src/arb/verifyTrustedBundle.ts`
- `src/api/server.ts`
- `scripts/test-step33-trust-aware-verify.ts`

Request additions:
- `trustPolicyProfile`: `dev` or `strict`
- `attestationPolicy`: optional inline override
- `sourceVerification`: optional verification result object
- `requireSourceVerification`: optional boolean override
- `requireSourceVerificationOk`: optional boolean override

Test:
- `pnpm step33:test`

Artifact:
- `artifacts/step33.trusted-verify.json`

Done condition:
- `/api/verify` can report a bundle as structurally valid but trust-policy invalid when source verification or attestation policy checks fail
