# LN Prop Advisor

LN Prop Advisor is a local-first Lightning operator app built around browser-side telemetry access, privacy-reduced Props payloads, and verifiable recommendation output.

The intended model is:
- the operator runs the frontend locally
- the browser connects to the node through Lightning Node Connect (LNC)
- raw node telemetry stays in the browser
- only privacy-reduced data is sent to the recommendation path
- attestation and verification metadata are shown back in the UI

## Current Product State

Working today:
- `Channels` page
- `Verified Phala` route for channel fee recommendations
- outgoing payload inspector in the UI
- live app evidence and verification status in the UI

Not yet moved to the verified Phala path:
- `Node Analysis`
- `Opening Recs`

## Docs

Start here:
- [docs/README.md](./docs/README.md)

Recommended reading order:
1. [docs/local-self-hosted.md](./docs/local-self-hosted.md)
2. [docs/trust-model.md](./docs/trust-model.md)
3. [docs/channels-phala-verified.md](./docs/channels-phala-verified.md)
4. [docs/current-scope.md](./docs/current-scope.md)

## Quick Start

Install dependencies:

```bash
pnpm install
```

Create a local env file:

```bash
cp .env.example .env
```

For the verified `Channels` path, set at least:

```env
VITE_ENABLE_PHALA_VERIFIED_UI=true
VITE_PHALA_MINIMAL_APP_URL=https://YOUR-PHALA-APP-URL
```

Then start the frontend:

```bash
pnpm dev --host
```

Open:

```text
http://localhost:5173
```

Connect your node through LNC in the browser, open `Channels`, choose a channel, and run `Analyze Channel`.

## Why local-first matters

This project is trying to give Lightning operators a better trust model than "send all your raw node data to someone else's server".

The important property is not "no trust".
It is:

- trust the local code you choose to run
- do not send raw telemetry to a backend by default
- inspect the exact outgoing request in the UI
- verify the recommendation result and execution evidence

That is why the outgoing payload inspector and self-hosted workflow matter.

## Phala configuration

For the frontend, the Phala app is currently just a configuration value:

- `VITE_PHALA_MINIMAL_APP_URL`

In practice, this should be treated as operator/deployment configuration, not something a normal user edits repeatedly.

## Repository note

The repo also contains:
- historical step docs in `docs/step-*.md`
- Phala deployment material in `deploy/phala-minimal-prototype/`
- local API/server work for the standard non-Phala path

Those are useful for development, but the main user-facing story should start from the docs listed above.
