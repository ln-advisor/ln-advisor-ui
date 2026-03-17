# Local Self-Hosted Setup

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

The verified service URL is built into the frontend configuration. You do not need to add it here.

## Optional values for browser LNC login

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

## Start the frontend

```bash
pnpm dev --host
```

Open:

```text
http://localhost:5173
```

## Start the local API

Start the local API only if you need the standard/local routes:

```bash
pnpm api
```

## Verified pages

The verified route is available in:

1. `Channels`
2. `Opening Recommendations`

Each verified run follows the same interaction:

1. open the page
2. choose `Verified`
3. click `Review Request`
4. review the request body
5. click `Send Request`
6. inspect the result
