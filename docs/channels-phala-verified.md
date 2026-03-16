# Channels Verified Phala Flow

## Run steps

1. Browser connects to the node through LNC
2. Browser reads channel and node context locally
3. Browser normalizes the selected channel context
4. Browser applies the Props privacy transform
5. Browser builds a reduced Phala telemetry payload
6. Browser sends the reduced payload to the Phala app
7. Browser fetches live app evidence from the Phala app
8. Browser asks the Phala app to verify the result
9. UI renders:
   - recommendation
   - verification result
   - verification panel

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

## UI sections to inspect

### Stage 1: Raw
- locally collected data for the selected channel context

### Stage 2: Normalized
- structured local intermediate state

### Stage 3: PROPS Final Payload
- privacy-reduced data prepared for the recommendation path

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
- measurement status
- attestation source
- live evidence policy
