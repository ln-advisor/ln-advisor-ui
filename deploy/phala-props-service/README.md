# Phala Props API Service

Purpose:
- deploy the current API server to a low-cost Phala CPU CVM
- default to `LIGHTNING_SNAPSHOT_MODE=mock` for cheap smoke testing
- use `cloud_cvm_attestation` first; add app HTTP attestation later if the image exposes `/info` and `/attestation`

Files:
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`

Deploy from the repo root:

```bash
cp deploy/phala-props-service/.env.example deploy/phala-props-service/.env
bash scripts/phala-props-deploy.sh
```

Notes:
- this scaffold runs the existing `pnpm api` service inside Phala
- it mounts `/var/run/dstack.sock` so a later app-attestation sidecar path remains possible
- it does not require GPU
