# Channels Verified Phala Flow

This document describes the verified recommendation flow currently implemented on the `Channels` page.

## Current scope

This is the main Phala-backed UI flow in the app today.

It applies to:
- `Channels`

It does not yet apply to:
- `Node Analysis`
- `Opening Recs`

## High-level flow

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
   - trust metadata

## Requests involved

In development, the browser uses the local Vite proxy:
- `/__phala/...`

That avoids browser CORS issues while still exposing the exact request plan in the UI.

The verified flow uses:
- `POST /api/recommend?full=true`
- `GET /health`
- `GET /info?full=true`
- `GET /attestation?full=true`
- `POST /api/verify`

In the UI, these are visible in:
- `PROPS Pipeline Explorer`
- `Stage 4: Outgoing Browser Requests`

## What the operator can inspect

The `Channels` page now exposes:

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

This is important.
It lets the operator verify what is actually leaving the browser.

## What the trust panel shows

After a successful verified run, the UI shows:
- signer
- signer type
- quote check
- measurement status
- attestation source
- live evidence policy

This is the operator-facing summary of the verification path.

## Configuration

The main frontend config value for this flow is:

- `VITE_PHALA_MINIMAL_APP_URL`

This is effectively deployment configuration for the verified provider.
It is not something a normal user should need to change frequently.

## Recommendation

For the current product state, treat the verified `Channels` flow as:
- the main attested recommendation path
- the main privacy-inspection path
- the strongest current demonstration of the Props model in the app
