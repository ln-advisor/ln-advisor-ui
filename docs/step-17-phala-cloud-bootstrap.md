# Step 17 - Phala Cloud Bootstrap

Step 17 introduces a Phala-specific integration boundary that can be used by the enclave path without changing UI behavior.

## What Was Added

- `src/tee/phala/constants.ts`
  - Official platform/docs links.
  - Cloud API base URL and header-based API version constants.
  - Endpoint constants for:
    - `POST /cvms/provision`
    - `POST /cvms`
    - `PATCH /cvms/{cvmId}/envs`
    - `PATCH /cvms/{cvmId}/docker-compose`
    - `GET /kms/{kms}/pubkey/{app_id}`
    - `GET /cvms/{cvmId}/attestation`
    - `POST /attestations/verify`

- `src/tee/phala/types.ts`
  - Versioned response parser targets:
    - `CurrentUserV20260121`
    - `CvmInfoV20260121`
  - Structured parser helpers for provision/commit/attestation responses.

- `src/tee/phala/encryptedEnv.ts`
  - Secure environment payload encryption helper:
    - X25519 key agreement
    - HKDF-SHA256 key derivation
    - AES-256-GCM encryption
  - Deterministic mode for local fixtures/tests.

- `src/tee/phala/client.ts`
  - Typed client wrapper over Phala Cloud API.
  - Includes:
    - Two-phase CVM provision + commit methods.
    - Encrypted env update helper (`get KMS pubkey -> encrypt -> patch envs`).
    - Compose update method.
    - CVM attestation fetch + quote verification method.

- `src/tee/phala/verifier.ts`
  - External verifier skeleton:
    - Fetches app `/attestation` and `/info`.
    - Recomputes compose hash from `tcb_info.app_compose`.
    - Compares compose hash against RTMR3 event-log compose-hash event.
    - Calls Phala `POST /attestations/verify`.
    - Returns structured pass/fail checks.

## Step 17 Test + Artifact

- CLI test:
  - `pnpm tsx scripts/test-step17-phala-cloud.ts`
- JSON artifact:
  - `artifacts/step17.phala-cloud-bootstrap.json`
- Pass condition:
  - API version header is applied.
  - Provision -> commit flow is executed.
  - Encrypted env update flow is executed.
  - Compose update flow is executed.
  - External attestation verifier passes on deterministic mock evidence.
