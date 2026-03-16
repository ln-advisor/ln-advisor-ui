# Phala Minimal Prototype

Purpose:
- deploy a very small HTTP API to Phala
- prove the Phala wiring works before using the full advisor API
- keep cost low by avoiding custom image builds and heavyweight runtime dependencies

Endpoints:
- `GET /health`
- `GET /info`
- `GET /attestation`
- `POST /api/snapshot`
- `POST /api/recommend`
- `POST /api/verify`

Default response shape:
- `GET /info`, `GET /attestation`, `POST /api/recommend`, and `POST /api/verify` now return compact payloads by default so terminal output stays short
- add `?full=true` when you need the full quote or full `app_compose` body for verification or debugging
- the automated verification tests use `?full=true` only where the full payload is actually required

`POST /api/snapshot` is now the first real operation in the minimal prototype:
- input: a small telemetry payload with `nodeAlias`, `channels[]`, and optional `privacyMode`
- output: a deterministic `feature_only` or `banded` transformed snapshot
- exact channel ids, peer pubkeys, and balances are not returned

`POST /api/recommend` is now the second real operation:
- input: a small telemetry payload with `nodeAlias` and `channels[]`
- internal processing: derives `feature_only` state
- output: deterministic fee actions (`raise`, `lower`, `hold`) plus a transformed snapshot, source receipt, summary counts, and a payload-bound prototype ARB signed through the selected signer provider

`POST /api/verify` now checks:
- digest binding between transformed input and recommendation output
- signer provider policy
- HMAC signature validity for the `env_hmac` provider
- optional attestation policy checks
- optional source receipt binding checks
- optional live app evidence binding checks using caller-supplied `/info` and `/attestation` payloads
- optional quote verification against Phala's cloud attestation API

Deploy:

```bash
cp deploy/phala-minimal-prototype/.env.example deploy/phala-minimal-prototype/.env
bash scripts/phala-minimal-deploy.sh
```

Update existing CVM:

```bash
phala link ln-advisor-phala-minimal
phala deploy -c deploy/phala-minimal-prototype/docker-compose.rendered.yml
```

Notes:
- this compose file uses the stock `node:22-alpine` image
- `platform: linux/amd64` is set explicitly to match Phala's x86_64 runtime guidance
- `/var/run/dstack.sock` is mounted so the prototype can read real runtime attestation when enabled
- the compose runtime is generated from `server.mjs`; run `pnpm phala:minimal:sync` after editing the server file
- `pnpm phala:minimal:sync` now emits:
  - `docker-compose.yml` with placeholders
  - `docker-compose.rendered.yml` with concrete values from the current environment
- when deploying to an existing CVM, prefer `docker-compose.rendered.yml` so Phala receives the exact runtime values you set locally
- the server starts via `node --input-type=module -e` to avoid Docker build-context issues during CVM boot
- set `PROTOTYPE_SIGNER_PROVIDER_TYPE=env_hmac` to use the env-backed HMAC provider
- set `PROTOTYPE_SIGNER_PROVIDER_TYPE=phala_kms_stub` to exercise the non-implemented provider path
- set `PROTOTYPE_ARB_SIGNING_KEY` to override the default prototype HMAC key
- set `PROTOTYPE_ARB_REQUIRE_EXPLICIT_KEY=true` to fail closed unless a non-default signing key is configured
- set `PROTOTYPE_SIGNER_PROVIDER_ID`, `PROTOTYPE_ARB_VERIFY_ALLOWED_SIGNER_PROVIDER_ID`, and `PROTOTYPE_ARB_VERIFY_EXPECTED_SIGNER_PROVIDER_TYPE` to model signer-provider policy
- set `PROTOTYPE_VERIFY_REQUIRE_ATTESTATION=true` plus the `PROTOTYPE_ATTESTATION_*` and `PROTOTYPE_VERIFY_ALLOWED_*` envs to enforce prototype attestation policy
- set `PROTOTYPE_VERIFY_REQUIRE_SOURCE_RECEIPT=true` to require source receipt binding during verification
- set `PROTOTYPE_VERIFY_REQUIRE_LIVE_APP_EVIDENCE=true` to require caller-supplied live `/info` and `/attestation` evidence during verification
- set `PROTOTYPE_VERIFY_REQUIRE_CLOUD_APP_VERIFICATION=true` plus `PHALA_CLOUD_API_KEY` to require quote verification via Phala's cloud API during live app evidence checks
- set `PROTOTYPE_ATTESTATION_SOURCE=dstack_runtime` to read `/info` and `/attestation` from the mounted dstack runtime instead of prototype env values
- set `PROTOTYPE_DSTACK_ENDPOINT=http://127.0.0.1:8090` only for simulator or local test harness use; production Phala should use the mounted socket
- when using `dstack_runtime`, start with `PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT=runtime-discovery-placeholder`, then pin the real runtime measurement with `APP_URL=https://... bash scripts/phala-minimal-pin-runtime-measurement.sh deploy/phala-minimal-prototype/.env`
- `/health` now reports `measurementPolicy` so you can see whether the live runtime measurement is still a placeholder or actually pinned
- override `PHALA_CLOUD_API_BASE_URL` or `PHALA_API_VERSION` only when you need to point the prototype at a different Phala API environment
