# Step 24 - Live Attestation Source Verification

Step 24 adds a live CLI test that verifies Phala attestation using an explicitly selected source.

## What Was Added

- `scripts/test-step24-phala-attestation-source-live.ts`
  - Uses `verifyPhalaAttestationBySource(...)` from Step 23.
  - Auto-loads local env files in this order:
    - `.env.test`
    - `.env`
  - Supports live source selection:
    - `cloud_cvm_attestation` (requires `PHALA_CVM_ID`)
    - `app_http_attestation` (requires `PHALA_APP_BASE_URL`)
  - Writes one artifact with selected source, checks, and verification output.

- `package.json`
  - Adds `step24:test`.

## CLI Test

- `pnpm step24:test`

## Environment Variables

- Required:
  - `PHALA_API_KEY`
- Optional:
  - `PHALA_CLOUD_API_BASE_URL` (default `https://cloud-api.phala.network/api/v1`)
  - `PHALA_API_VERSION` (default `2026-01-21`)
  - `PHALA_ATTESTATION_SOURCE` (`cloud_cvm_attestation` or `app_http_attestation`)
  - `PHALA_CVM_ID` (required for `cloud_cvm_attestation`)
  - `PHALA_APP_BASE_URL` (required for `app_http_attestation`)
  - `PHALA_EXPECTED_REPORT_DATA_HEX`

Create local file:

- `cp .env.test.example .env.test`

## JSON Artifact

- `artifacts/step24.phala-attestation-source-live.json`

## Done Condition

- Selected live attestation source verifies successfully with required source-specific inputs.
