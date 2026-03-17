# Opening Recommendations Verified Phala Flow

## Use the page

1. connect your node in the browser
2. open `Opening Recommendations`
3. click `Sync Graph Data`
4. choose `Verified Phala`
5. click `Review & Send`
6. review the request body
7. click `Send to Phala`

## Result sections

After a successful run, the page shows:
- candidate peer cards
- score and reasons
- `Phala Trust Status`
- `PROPS Pipeline Explorer`

## Requests used by the verified flow

In development, the browser uses the local Vite proxy:
- `/__phala/...`

The verified flow uses:
- `POST /api/recommend?full=true`
- `GET /health`
- `GET /info?full=true`
- `GET /attestation?full=true`
- `POST /api/verify`

In the UI, these are visible in:
- `PROPS Pipeline Explorer`
- `Stage 4: Outgoing Browser Requests`

## Review modal

Before the request is sent, the review modal shows:
- route
- transport
- request list
- exact primary request body
- request size in bytes

Use:
- `Cancel` to stop
- `Send to Phala` to continue

## Pipeline Explorer

### Stage 1: Raw
- local graph and mission-control counts used for the run

### Stage 2: Normalized
- structured node state with candidate peers

### Stage 3: PROPS Final Payload
- reduced payload prepared for the verified run

### Stage 4: Outgoing Browser Requests
- exact request body
- exact endpoint
- exact method
- request size in bytes

## Verification panel fields

After a successful verified run, the UI shows:
- signer
- signer type
- quote check
- measurement
- attestation source
- live evidence
