# Source Collection Receipts

## Purpose

This document defines the next source-proof layer for LN Advisor. It does not change the live recommendation flow yet. It adds the receipt format and the rollout plan for authenticated source binding.

## Current state

LN Advisor already has these pieces:

1. local collection through LNC
2. normalization into `normalized-node-state-v1`
3. privacy transform into `privacy-node-state-v1`
4. pinned model metadata
5. signed recommendation binding through ARB
6. verified runtime support for the recommendation pages

The missing piece is authenticated source collection for verified mode.

Today, some routes still use a fallback provenance path that hashes the already privacy-filtered payload and uses that hash as a placeholder for earlier collection stages. That is useful for local binding, but it is not a source proof.

## What is added now

This repo now includes a draft foundation for source receipts in:

1. `src/arb/sourceCollectionReceipt.ts`

It adds:

1. `source-collection-receipt-v1`
2. deterministic RPC set hashing
3. deterministic receipt building
4. structural receipt verification
5. provenance binding helper

This foundation is not wired into the live API path yet. Existing recommendation flows stay unchanged.

## Receipt shape

The receipt format is:

```json
{
  "schemaVersion": "source-collection-receipt-v1",
  "sourceType": "lnd_signed_collector",
  "nodePubkey": "<node pubkey>",
  "collectedAt": "<iso timestamp>",
  "challengeNonce": "<verifier nonce>",
  "rpcSet": [
    "GetInfo",
    "ListChannels",
    "ForwardingHistory",
    "DescribeGraph",
    "GetNodeInfo",
    "QueryMissionControl"
  ],
  "rpcSetHash": "<sha256 canonical rpc set>",
  "sessionScope": {
    "transport": "lnc",
    "macaroonScope": "read-only-collector"
  },
  "rawSnapshotHash": "<sha256 canonical raw snapshot>",
  "normalizedSnapshotHash": "<sha256 canonical normalized snapshot>",
  "privacyTransformedSnapshotHash": "<sha256 canonical feature_only payload>",
  "modelInputHash": "<current design uses the same feature_only hash>",
  "collectorVersion": "<collector build or image identifier>"
}
```

Optional proof material:

1. LND signature for `lnd_signed_collector`
2. attestation metadata for `tee_attested_collector`

## Trust levels

The intended trust levels are:

1. `Local`
   Browser collected. Privacy preserving. Internal provenance only.
2. `Verified Execution`
   Reduced payload plus verified runtime for scoring. Current verified recommendation path.
3. `Verified Source`
   Collector signed or enclave attested source receipt, then reduced payload scoring.

Only the third level should claim authenticated source collection.

## Planned rollout

### Phase 1

Signed collector sidecar.

The collector runs next to LND or litd with a restricted macaroon. It fetches the RPC set, builds the raw snapshot, normalizes it, applies `feature_only`, and signs the receipt body with the node key.

Expected output:

1. privacy payload
2. source collection receipt
3. receipt hash for provenance binding

### Phase 2

Verified source mode in the API.

The verify path should accept the receipt, verify the signature, and bind the receipt hash into the provenance object. At that point the UI can expose a separate `verified source` label.

### Phase 3

TEE collector.

Move the collector into the enclave boundary. The collector should fetch the snapshot, apply the privacy transform, and emit an attested receipt. The attestation should bind:

1. collector image or measurement
2. nonce
3. privacy-transformed payload hash
4. optionally the model manifest hash

### Phase 4

ARB source binding.

Once the receipt is live, ARB should bind:

1. source collection receipt hash
2. raw snapshot hash
3. normalized snapshot hash
4. privacy-transformed snapshot hash
5. model manifest hash
6. attestation hash when present

## What stays unchanged right now

1. `Channel Fees`
2. `Opening Recommendations`
3. `Node Analysis`
4. `Conditional Recall`
5. the current local and verified runtime flows

This work is scaffolding only. It prepares the source-proof path without changing live behavior.

## Next implementation step

The next concrete implementation should be:

1. add a collector sidecar that receives a nonce
2. build `source-collection-receipt-v1`
3. sign the receipt with the node key
4. verify that receipt in `/api/verify`
5. gate a new `verified source` mode on successful receipt verification
