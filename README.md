# LN Advisor UI

## Docs

- [Install and Run](https://ln-advisor-docs.vercel.app/)
- [LNC](https://ln-advisor-docs.vercel.app/lnc.html)
- [Channel Fees](https://ln-advisor-docs.vercel.app/channelfees.html)
- [Openings](https://ln-advisor-docs.vercel.app/openings.html)
- [Node Analysis](https://ln-advisor-docs.vercel.app/nodeanalysis.html)
- [Private Pipeline](https://ln-advisor-docs.vercel.app/privatepipeline.html)
- [Conditional Recall](https://ln-advisor-docs.vercel.app/conditionalrecall.html)

## Start

Requirements:

- Node.js
- pnpm

Install and create the env file:

```bash
pnpm install
cp .env.example .env
```

Minimum `.env` values:

```env
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_ENABLE_PHALA_VERIFIED_UI=true
API_PORT=8787
```

Start the frontend:

```bash
pnpm dev --host
```

Start the local API if you want `Local` mode:

```bash
pnpm api
```

Open:

```text
http://localhost:5173
```

If you want the verified frontend to call your own service:

```env
VITE_PHALA_MINIMAL_APP_URL=https://your-verified-service-url
```

## Use In The Frontend

### Connect your node

For a real session:

1. paste the LNC pairing phrase
2. enter the password
3. click `Connect & Save Session`

For later sessions:

1. enter the password
2. click `Login`

### Node Analysis

1. open `Node Analysis`
2. click `Fetch Data`
3. inspect graph state, forwarding history, mission control, and centrality

### Channel Fees

1. open `Channel Fees`
2. select a channel
3. choose `Local` or `Verified Runtime (TEE)`
4. in verified mode, click `Review Request`
5. inspect the request body
6. run the recommendation

### Opening Recommendations

1. open `Opening Recommendations`
2. click `Sync Graph Data`
3. choose `Local` or `Verified Runtime (TEE)`
4. in verified mode, click `Review Request`
5. inspect the request body
6. run the recommendation

### After a verified run

In verified mode the UI shows:

- the recommendation result
- `Verification Status`
- `Request Inspector`
