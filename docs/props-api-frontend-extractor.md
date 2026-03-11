# Props API (Frontend Extractor Mode)

This project now supports the frontend-extractor flow:

1. UI gathers telemetry directly from LNC.
2. UI sends telemetry payload to API (`frontend-telemetry-envelope-v1`).
3. API normalizes, applies privacy transform, runs deterministic scoring, and returns signed ARB.
4. UI verifies ARB before any OpenClaw action.

## Endpoints

### `POST /api/snapshot`

Request body:

```json
{
  "telemetry": {
    "schemaVersion": "frontend-telemetry-envelope-v1",
    "collectedAt": "2026-03-11T00:00:00.000Z",
    "namespace": "tapvolt",
    "nodeInfo": {},
    "channels": [],
    "forwardingHistory": [],
    "routingFailures": [],
    "feePolicies": [],
    "peers": [],
    "graphSnapshot": { "nodes": [], "edges": [] },
    "missionControl": { "pairs": [] },
    "nodeMetrics": { "betweennessCentrality": {} }
  }
}
```

### `POST /api/recommend`

Request body:

```json
{
  "telemetry": { "...": "same schema as /api/snapshot" },
  "privacyMode": "feature_only",
  "issuedAt": "optional ISO timestamp"
}
```

Notes:
- Scoring input is always `feature_only` privacy output.
- Recommendation IDs are obfuscated refs (`channelRef`, `peerRef`).

### `POST /api/verify`

Request body:

```json
{
  "arb": {},
  "sourceProvenance": {}
}
```

or path-based:

```json
{
  "arbPath": "artifacts/recommendation-bundle.arb.json",
  "sourceProvenancePath": "artifacts/source-provenance.json"
}
```

## Ref mapping rule

For local execution mapping in UI:
- `channelRef` is assigned by sorted channel ID order: `channel_0001`, `channel_0002`, ...
- `peerRef` is assigned by sorted peer pubkey order: `peer_0001`, `peer_0002`, ...

Mapping is generated in `src/privacy/applyPrivacyPolicy.ts`.
