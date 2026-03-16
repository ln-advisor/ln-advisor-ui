# Step 18 - Phala Live Smoke (Low-Credit)

Step 18 adds a minimal read-only live integration test for Phala.

## Why This Step

- It validates real credentials and endpoint wiring.
- It avoids credit-heavy operations.
- It does not provision new CVMs or patch runtime configuration.

## What It Calls

- Always:
  - `GET /users/me`
- Optional (if `PHALA_CVM_ID` is set):
  - `GET /cvms/{cvmId}`
- Optional (if `PHALA_APP_BASE_URL` is set):
  - App `GET /attestation`
  - App `GET /info`
  - `POST /attestations/verify`

## What It Explicitly Does Not Call

- `POST /cvms/provision`
- `POST /cvms`
- `PATCH /cvms/{cvmId}/envs`
- `PATCH /cvms/{cvmId}/docker-compose`

## File Added

- `scripts/test-step18-phala-live-smoke.ts`

## CLI Test

- `pnpm step18:test`

## Environment Variables

- Required:
  - `PHALA_API_KEY`
- Optional:
  - `PHALA_CLOUD_API_BASE_URL` (default: `https://cloud-api.phala.network/api/v1`)
  - `PHALA_API_VERSION` (default: `2026-01-21`)
  - `PHALA_APP_BASE_URL` (your dstack app URL; enables external attestation verification)
  - `PHALA_CVM_ID` (enables CVM info fetch)

## JSON Artifact

- `artifacts/step18.phala-live-smoke.json`

## Done Condition

- Cloud API auth succeeds and, when `PHALA_APP_BASE_URL` is provided, app attestation verification passes.
