import assert from "node:assert/strict";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";
import {
  bindSourceCollectionReceiptToProvenance,
  buildSourceCollectionReceipt,
  deriveRpcSetHash,
  verifySourceCollectionReceipt,
} from "../src/arb/sourceCollectionReceipt";
import { hashCanonicalJson } from "../src/scoring/modelManifest";

async function main(): Promise<void> {
  const rawSnapshot = getMockLightningSnapshot();
  const normalizedSnapshot = normalizeSnapshot(rawSnapshot);
  const privacySnapshot = applyPrivacyPolicy(normalizedSnapshot, "feature_only");

  const receipt = buildSourceCollectionReceipt({
    sourceType: "lnd_signed_collector",
    nodePubkey: String(rawSnapshot.nodeInfo?.identityPubkey || ""),
    collectedAt: rawSnapshot.collectedAt,
    challengeNonce: "nonce-001",
    rpcSet: ["ListChannels", "GetInfo", "DescribeGraph", "ListChannels", "ForwardingHistory"],
    collectorVersion: "collector-dev-build",
    sessionScope: {
      macaroonScope: "read-only-collector",
    },
    rawSnapshot,
    normalizedSnapshot,
    privacyTransformedSnapshot: privacySnapshot,
    signature: {
      scheme: "lnd_signmessage_node_key",
      value: "placeholder-signature",
    },
  });

  assert.deepEqual(
    receipt.rpcSet,
    ["DescribeGraph", "ForwardingHistory", "GetInfo", "ListChannels"],
    "RPC set should be normalized into a stable canonical order."
  );
  assert.equal(
    receipt.rpcSetHash,
    deriveRpcSetHash(["ForwardingHistory", "GetInfo", "ListChannels", "DescribeGraph"]),
    "RPC set hash should be stable for equivalent RPC lists."
  );
  assert.equal(
    receipt.rawSnapshotHash,
    hashCanonicalJson(rawSnapshot),
    "rawSnapshotHash should match the canonical raw snapshot hash."
  );
  assert.equal(
    receipt.normalizedSnapshotHash,
    hashCanonicalJson(normalizedSnapshot),
    "normalizedSnapshotHash should match the canonical normalized snapshot hash."
  );
  assert.equal(
    receipt.privacyTransformedSnapshotHash,
    hashCanonicalJson(privacySnapshot),
    "privacyTransformedSnapshotHash should match the canonical privacy payload hash."
  );

  const verifyPass = verifySourceCollectionReceipt({
    receipt,
    rawSnapshot,
    normalizedSnapshot,
    privacyTransformedSnapshot: privacySnapshot,
    requireSignatureForLnd: true,
  });
  assert.equal(verifyPass.ok, true, `sourceCollectionReceipt should verify (${verifyPass.errors.join(" | ")})`);

  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalizedSnapshot, {
    privacyTransformedSnapshot: privacySnapshot,
  });
  const boundProvenance = bindSourceCollectionReceiptToProvenance(provenance, receipt);

  assert.equal(
    boundProvenance.rawSnapshotHash,
    receipt.rawSnapshotHash,
    "bound provenance should adopt the receipt raw snapshot hash."
  );
  assert.equal(
    boundProvenance.normalizedSnapshotHash,
    receipt.normalizedSnapshotHash,
    "bound provenance should adopt the receipt normalized snapshot hash."
  );
  assert.equal(
    boundProvenance.privacyTransformedSnapshotHash,
    receipt.privacyTransformedSnapshotHash,
    "bound provenance should adopt the receipt privacy snapshot hash."
  );
  assert.equal(
    boundProvenance.executionContext.sourceCollectionReceiptType,
    receipt.sourceType,
    "bound provenance should record the receipt source type."
  );
  assert.equal(
    boundProvenance.executionContext.sourceCollectionReceiptHash,
    hashCanonicalJson(receipt),
    "bound provenance should record the receipt hash."
  );

  const tamperedReceipt = {
    ...receipt,
    rpcSetHash: "0".repeat(64),
  };
  const verifyFail = verifySourceCollectionReceipt({
    receipt: tamperedReceipt,
    rawSnapshot,
    normalizedSnapshot,
    privacyTransformedSnapshot: privacySnapshot,
    requireSignatureForLnd: true,
  });
  assert.equal(verifyFail.ok, false, "tampered receipt hash should fail verification.");

  console.log("Source collection receipt test: PASS");
}

main().catch((error) => {
  console.error("Source collection receipt test failed.", error);
  process.exitCode = 1;
});
