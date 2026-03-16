# Step 39: Phala Minimal Prototype

Objective:
- create a very small hardcoded HTTP service that can be deployed to Phala cheaply to validate the deployment path before using the full advisor API
- keep the deployment path simple by using a stock runtime image instead of relying on a custom image build inside the CVM
- keep startup as simple as possible by using a direct `node -e` command on a small public image

Files:
- `deploy/phala-minimal-prototype/server.mjs`
- `deploy/phala-minimal-prototype/Dockerfile`
- `deploy/phala-minimal-prototype/docker-compose.yml`
- `deploy/phala-minimal-prototype/.env.example`
- `deploy/phala-minimal-prototype/README.md`
- `scripts/phala-minimal-deploy.sh`
- `scripts/test-step39-phala-minimal-prototype.mjs`

Routes:
- `GET /health`
- `POST /api/snapshot`
- `POST /api/recommend`
- `POST /api/verify`

Test:
- `pnpm step39:test`

Artifact:
- `artifacts/step39.phala-minimal-prototype.json`

Deploy command:
- `pnpm phala:minimal:deploy`

Done condition:
- the minimal hardcoded service runs locally and the repo contains a low-cost Phala deploy scaffold for it
- the Phala scaffold uses a concrete runtime image and does not depend on a local Docker build context
- the Phala scaffold uses an explicit `linux/amd64` public image and avoids shell-level boot scripts
