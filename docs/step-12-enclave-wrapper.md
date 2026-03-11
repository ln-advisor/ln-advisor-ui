# Step 12 - Enclave Wrapper Plan

This step defines enclave migration boundaries without changing UI behavior.

## Candidate Modules

1. `normalize_snapshot`
- Current entrypoint: `src/normalization/normalizeSnapshot.ts#normalizeSnapshot`
- Input: `LightningSnapshot` (`lightning-snapshot-v1`)
- Output: `NormalizedNodeState` (`normalized-node-state-v1`) + canonical hash

2. `privacy_transform`
- Current entrypoint: `src/privacy/applyPrivacyPolicy.ts#applyPrivacyPolicy`
- Input: `NormalizedNodeState` + `PrivacyMode`
- Output: `PrivacyTransformedNodeState` (`privacy-node-state-v1`) + canonical hash

3. `score_node_state`
- Current entrypoint: `src/scoring/scoreNodeState.ts#scoreNodeState`
- Input: `NormalizedNodeState`
- Output: `RecommendationSetV1` (`recommendation-set-v1`) + canonical hash + model version

4. `arb_signer`
- Current entrypoint: `src/arb/buildArb.ts#buildArb`
- Input: `RecommendationSetV1`, `SourceProvenanceReceipt`, `privacyPolicyId`, signing key
- Output: `ArbBundle` (`arb-v1`) + canonical hash + signature digest

## Host vs Enclave Responsibility

- Host keeps:
  - Data fetch from LNC (or mock)
  - Provenance receipt generation orchestration
  - Final ARB verification
- Enclave candidate boundary keeps:
  - Normalize
  - Privacy transform
  - Scoring
  - ARB signing

## Current Adapter

- `src/arb/enclave/localAdapter.ts` is a local implementation of enclave interfaces.
- `src/arb/enclave/pipeline.ts` orchestrates those four modules in strict order.
- This allows drop-in replacement with a real TEE runtime later without redesigning module contracts.

## Artifact/Test

- Script: `pnpm tsx scripts/export-enclave-contracts.ts`
- Artifact: `artifacts/enclave-candidates.contracts.json`
- Pass condition: contract export succeeds and boundary smoke verification passes.
