# Step 32: Source-Gated Recommend

Objective:
- require strict `POST /api/recommend` to verify an approved attestation source before issuing a released-signer ARB

Files:
- `src/api/sourceVerification.ts`
- `src/api/server.ts`
- `scripts/test-step32-source-gated-recommend.ts`

Runtime:
- strict mode now expects both released-signer config and Phala source-verification config
- supported sources:
  - `cloud_cvm_attestation`
  - `app_http_attestation`

Test:
- `pnpm step32:test`

Artifact:
- `artifacts/step32.source-gated-recommend.json`

Done condition:
- strict recommend fails closed without source verification runtime
- strict recommend signs only after source verification passes under policy
