# LN Prop Advisor

LN Prop Advisor is a Lightning operator UI.

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
