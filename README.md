# LN Prop Advisor

LN Prop Advisor is a Lightning node analysis tool powered by Lightning Node Connect (LNC), protected data pipelines (Props), and lightweight ML/AI signals. It helps operators make better fee, liquidity, and peer decisions without exporting raw private telemetry.

## What It Does
- Connects to your Lightning node via LNC.
- Pulls authenticated private telemetry and combines it with public graph context.
- Applies privacy-preserving feature transforms.
- Runs a pinned scoring/model workflow.
- Produces recommendation bundles with clear provenance.

## Core Idea (Props Applied to Lightning)
Public graph data is useful but incomplete. The most valuable optimization signals live inside a node’s private state (fees, balances, forward history, failures). Props-style pipelines let us use those signals safely:
- **Privacy**: only derived features are exposed, not raw telemetry.
- **Integrity**: recommendations are tied to authenticated data sources.
- **Pinned inference**: outputs are tied to a known model/version.

## Current App Scope
The current UI focuses on graph-level analysis and operator insight:
- Graph snapshot and analytics (describeGraph)
- Channel capacity distributions
- Fee/ppm behavior by capacity
- Node connectivity and topology highlights

This aligns with the MVP focus: start with graph + authenticated node data, then add recommendation bundles.

## MVP Recommendations (Planned)
For the hackathon MVP we target two recommendation types:
1. Dynamic fee recommendations
2. Forward-opportunity ranking

Each recommendation will be packaged as an **Attested Recommendation Bundle (ARB)** with provenance metadata.

## Tech
- React + Vite
- Lightning Node Connect (`@lightninglabs/lnc-web`)
- Recharts for visualization

## Run Locally
1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start dev server:
   ```bash
   pnpm dev
   ```
3. Open the app:
   ```text
   http://localhost:5173
   ```

## Notes
This project is a prototype of a privacy-preserving intelligence layer for Lightning node operators. It is not a custodian and does not require raw telemetry export.
