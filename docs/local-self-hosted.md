# Local Self-Hosted Setup

This guide is for a real operator running LN Prop Advisor locally on their own machine.

The intended model is:
- run the frontend yourself
- connect your node in the browser through LNC
- inspect the exact request leaving the browser
- use the verified `Channels` route for recommendation + verification

This guide does not use mock mode.

## Two run modes

There are currently two useful ways to run the app.

### 1. Verified Channels only

Use this when you want:
- browser-local node access
- Phala-backed verified channel recommendations
- no local standard API required for the `Channels` verified flow

This is the simplest real-user path.

### 2. Full local app

Use this when you also want:
- standard local API routes
- non-Phala pages that still depend on the local app API

At the moment:
- `Channels` can use the verified Phala route
- `Node Analysis` and `Opening Recs` are still standard/local paths

## Required values

Create:

- `.env`

from:

- `.env.example`

### Minimum values for a real user

These are the main values you need:

```env
VITE_ENABLE_PHALA_VERIFIED_UI=true
VITE_PHALA_MINIMAL_APP_URL=https://YOUR-PHALA-APP-URL
VITE_API_BASE_URL=http://127.0.0.1:8787
API_PORT=8787
```

Notes:
- `VITE_PHALA_MINIMAL_APP_URL` is the main verified-provider config value
- in practice this is deployment/operator config and can be treated as fixed
- `VITE_API_BASE_URL` and `API_PORT` matter if you also want the standard/local routes available

## Values you do not need for the browser LNC path

Normal users do not need to pre-fill these for the verified `Channels` flow:

```env
LNC_PAIRING_PHRASE=
LNC_PASSWORD=
```

Why:
- the browser LNC flow asks the user to connect in the UI
- those values are not required in `.env` for that path

## Start the app

Install dependencies:

```bash
pnpm install
```

### Option A: verified Channels path only

Start the frontend:

```bash
pnpm dev --host
```

Open:

```text
http://localhost:5173
```

Then:
1. connect your node through the UI
2. go to `Channels`
3. open a channel
4. choose `Verified Phala`
5. click `Analyze Channel`
6. inspect:
   - `Stage 3: PROPS Final Payload`
   - `Stage 4: Outgoing Browser Requests`

### Option B: full local app

In one terminal:

```bash
pnpm api
```

In a second terminal:

```bash
pnpm dev --host
```

Use this when you want the standard/local routes available in addition to the verified `Channels` path.

## What to inspect in the UI

For the verified `Channels` path, the important UI sections are:

1. `PROPS Pipeline Explorer`
   - `Stage 1: Raw`
   - `Stage 2: Normalized`
   - `Stage 3: PROPS Final Payload`
   - `Stage 4: Outgoing Browser Requests`

2. `Phala Trust Status`
   - signer
   - signer type
   - quote check
   - measurement
   - attestation source
   - live evidence requirement

## Recommendation

For privacy-sensitive operators, the best story is:
- fork the repo
- run it locally
- inspect the outgoing request
- use the verified path only when the payload looks acceptable

That is the product model the current verified `Channels` flow is designed around.
