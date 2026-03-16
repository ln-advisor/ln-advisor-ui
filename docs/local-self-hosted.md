# Local Self-Hosted Setup

## Two run modes

### 1. Verified Channels only

Use this when you only need the verified `Channels` flow.

### 2. Full local app

Use this when you also need the standard/local pages and routes.

## Required values

Create:

- `.env`

from:

- `.env.example`

### Minimum values

```env
VITE_ENABLE_PHALA_VERIFIED_UI=true
VITE_API_BASE_URL=http://127.0.0.1:8787
API_PORT=8787
```

## Optional values for the browser LNC path

Leave these empty if you connect through the UI:

```env
LNC_PAIRING_PHRASE=
LNC_PASSWORD=
```

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

## What to inspect in the UI

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
