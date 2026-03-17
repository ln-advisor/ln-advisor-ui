# LN Advisor

LN Advisor is a Lightning operator UI.

## What it does

LN Advisor runs in the browser and connects to the node through LNC.

For verified workflows:
1. the browser reads the required node data locally
2. the UI builds a reduced request for the selected workflow
3. the operator reviews the exact request before it is sent
4. the service returns:
   - a recommendation
   - a signed result bundle
   - verification data shown in the UI

The verified workflows currently documented here are:
- `Channels`
- `Opening Recommendations`

## Start here

- [docs/README.md](./docs/README.md)

## Quick start

Install dependencies:

```bash
pnpm install
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Minimum values:

```env
VITE_ENABLE_PHALA_VERIFIED_UI=true
VITE_API_BASE_URL=http://127.0.0.1:8787
API_PORT=8787
```

Start the frontend:

```bash
pnpm dev --host
```

Open:

```text
http://localhost:5173
```

## Use the app

### Channels

1. connect your node in the browser
2. open `Channels`
3. open a channel
4. choose `Verified`
5. click `Review Request`
6. review the request body
7. click `Send Request`
8. inspect:
   - recommendation
   - `Verification Status`
   - `Request Inspector`

### Opening Recommendations

1. connect your node in the browser
2. open `Opening Recommendations`
3. click `Sync Graph Data`
4. choose `Verified`
5. click `Review Request`
6. review the request body
7. click `Send Request`
8. inspect:
   - candidate peer cards
   - `Verification Status`
   - `Request Inspector`

## Local API

Start the local API only if you need the standard/local routes:

```bash
pnpm api
```

## Repository layout

User-facing docs:
- [docs/README.md](./docs/README.md)
- [docs/local-self-hosted.md](./docs/local-self-hosted.md)
- [docs/channels-verified.md](./docs/channels-verified.md)
- [docs/opening-recommendations-verified.md](./docs/opening-recommendations-verified.md)
- [docs/verification-reference.md](./docs/verification-reference.md)

Deployment material:
- `deploy/phala-minimal-prototype/`
