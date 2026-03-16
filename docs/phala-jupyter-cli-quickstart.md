# Phala Jupyter CLI Quickstart

This quickstart is the minimal path to spin up a CVM, get attestation outputs, and clean up.

## Files Created

- `deploy/phala-jupyter/docker-compose.yml`
- `deploy/phala-jupyter/.env.example`
- `scripts/phala-jupyter-deploy.sh`
- `scripts/phala-jupyter-attestation.sh`
- `scripts/phala-jupyter-delete.sh`

## 1) Prepare env file

```bash
cd /mnt/c/development/rotator-shape/ln-advisor-ui
cp deploy/phala-jupyter/.env.example deploy/phala-jupyter/.env
nano deploy/phala-jupyter/.env
```

Set:

- `PHALA_CVM_NAME` (example: `jupyter-notebook`)
- `JUPYTER_TOKEN` (any strong value; this is notebook login token)
- `PHALA_DSTACK_HOST_SUFFIX` only if URL fallback is needed

## 2) Deploy CVM

```bash
pnpm phala:jupyter:deploy
```

This writes:

- `artifacts/phala-jupyter.cvm.json`

And prints export lines for:

- `PHALA_CVM_ID`
- `PHALA_APP_BASE_URL` (if detected)

## 3) Get attestation artifacts

```bash
pnpm phala:jupyter:attest
```

This writes:

- `artifacts/phala-jupyter.attestation.cli.json`
- `artifacts/phala-jupyter.info.http.json` (if app URL available)
- `artifacts/phala-jupyter.attestation.http.json` (if app URL available)

## 4) Clean up to stop billing

```bash
pnpm phala:jupyter:delete
```
