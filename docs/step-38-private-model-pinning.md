# Step 38: Private Model Pinning and Phala Scaffold

Objective:
- support `service_pinned_private_model` manifests for a future remote private model
- add a minimal Phala CPU CVM deploy scaffold for the current API service

Files:
- `src/scoring/modelManifest.ts`
- `deploy/phala-props-service/Dockerfile`
- `deploy/phala-props-service/docker-compose.yml`
- `deploy/phala-props-service/.env.example`
- `deploy/phala-props-service/README.md`
- `scripts/phala-props-deploy.sh`
- `scripts/test-step38-private-model-pinning.ts`

Test:
- `pnpm step38:test`

Artifact:
- `artifacts/step38.private-model-pinning.json`

Deploy command:
- `pnpm phala:props:deploy`

Done condition:
- ARBs can bind to `service_pinned_private_model` manifests and the repo contains a minimal Phala CLI deploy path for the current API on a CPU CVM
