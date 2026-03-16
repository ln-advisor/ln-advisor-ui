# LN Prop Advisor

LN Prop Advisor is a Lightning operator UI.

## Why Props

LN Prop Advisor uses a Props-style flow for channel recommendations.

In this app:
- the browser connects to the node and reads channel data locally
- the selected channel context is normalized in the UI
- a reduced payload is built before anything is sent to the verified service
- the service returns a recommendation plus evidence that the result came from the expected app and verification path

This is useful for Lightning operators because fee and liquidity decisions depend on sensitive node data. The verified `Channels` flow lets the operator inspect the outgoing payload, receive a recommendation, and check the verification result without treating a normal backend as the default place where raw node telemetry is processed.

## How the verified path works

The verified `Channels` flow uses a Phala-hosted service.

At a high level:
1. the browser reads channel data locally through LNC
2. the UI builds a reduced telemetry payload for the selected channel
3. that payload is sent to the verified service running on Phala
4. the service returns:
   - a recommendation
   - a signed result bundle
   - app evidence used for verification
5. the UI checks the verification result and shows it in `Phala Trust Status`

The Phala part matters because the service is not just returning a score. It also exposes app identity and attestation data, and the verification step checks that the result is tied to the expected runtime and signer policy.

In the current verified flow, the UI checks:
- the returned result bundle
- signer metadata
- pinned runtime measurement
- live app evidence
- cloud quote verification status

For the operator, that means the output is not only "here is a recommendation". It is also "here is the verification data for the environment that produced it".

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

Minimum values for the verified `Channels` flow:

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

Then:
1. connect your node in the browser
2. open `Channels`
3. open a channel
4. choose `Verified Phala`
5. click `Analyze Channel`
6. inspect:
   - `Stage 3: PROPS Final Payload`
   - `Stage 4: Outgoing Browser Requests`
   - `Phala Trust Status`

## Repository layout

User-facing docs:
- [docs/README.md](./docs/README.md)
- [docs/local-self-hosted.md](./docs/local-self-hosted.md)
- [docs/channels-phala-verified.md](./docs/channels-phala-verified.md)
- [docs/verification-reference.md](./docs/verification-reference.md)

Deployment material:
- `deploy/phala-minimal-prototype/`
