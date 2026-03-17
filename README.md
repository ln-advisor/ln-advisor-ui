# LN Prop Advisor

LN Prop Advisor is a Lightning operator UI.

## Why Props

LN Prop Advisor uses a Props-style flow for Lightning recommendations.

In this app:
- the browser connects to the node and reads data locally
- the UI normalizes the relevant node state
- the UI builds a reduced payload
- the operator reviews the exact outgoing request before it is sent
- the verified service returns a recommendation plus verification data

## How the verified path works

The verified flows use a Phala-hosted service.

At a high level:
1. the browser reads Lightning data locally through LNC
2. the UI builds a reduced payload for the selected workflow
3. the operator reviews the exact request body in the browser
4. that payload is sent to the verified service running on Phala
5. the service returns:
   - a recommendation
   - a signed result bundle
   - app evidence used for verification
6. the UI checks the verification result and shows it in `Phala Trust Status`

The verified pages currently documented here are:
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
4. choose `Verified Phala`
5. click `Review & Send`
6. review the request body
7. click `Send to Phala`
8. inspect:
   - recommendation
   - `Phala Trust Status`
   - `PROPS Pipeline Explorer`

### Opening Recommendations

1. connect your node in the browser
2. open `Opening Recommendations`
3. click `Sync Graph Data`
4. choose `Verified Phala`
5. click `Review & Send`
6. review the request body
7. click `Send to Phala`
8. inspect:
   - candidate peer cards
   - `Phala Trust Status`
   - `PROPS Pipeline Explorer`

## Local API

Start the local API only if you need the standard/local routes:

```bash
pnpm api
```

## Repository layout

User-facing docs:
- [docs/README.md](./docs/README.md)
- [docs/local-self-hosted.md](./docs/local-self-hosted.md)
- [docs/channels-phala-verified.md](./docs/channels-phala-verified.md)
- [docs/opening-recs-phala-verified.md](./docs/opening-recs-phala-verified.md)
- [docs/verification-reference.md](./docs/verification-reference.md)

Deployment material:
- `deploy/phala-minimal-prototype/`
