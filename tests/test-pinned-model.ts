import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArb } from "../src/arb/buildArb";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";
import { verifyArb } from "../src/arb/verifyArb";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import {
  DEFAULT_PINNED_MODEL_MANIFEST,
  buildPinnedModelManifest,
  canonicalJson,
  getPinnedModelManifestHash,
} from "../src/scoring/modelManifest";
import { scoreNodeState } from "../src/scoring/scoreNodeState";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "pinned-model.json");
const FIXED_DEV_SIGNING_KEY = "pinned-model-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function main(): Promise<void> {
  const rawSnapshot = getMockLightningSnapshot();
  const normalized = normalizeSnapshot(rawSnapshot);
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const recommendation = scoreNodeState(featureOnly, {
    nodePubkey: normalized.nodePubkey,
    nodeAlias: normalized.nodeAlias,
    collectedAt: normalized.collectedAt,
  });

  const manifest = DEFAULT_PINNED_MODEL_MANIFEST;
  const manifestHash = getPinnedModelManifestHash(manifest);
  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalized, {
    modelManifest: manifest,
    privacyTransformedSnapshot: featureOnly,
  });
  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    modelManifest: manifest,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const verifyPass = verifyArb({
    arb,
    sourceProvenance: provenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyPass.ok, `Pinned Model verifyArb failed: ${verifyPass.errors.join(" | ")}`);

  assert(
    provenance.executionContext.modelManifestHash === manifestHash,
    "Pinned Model failed: provenance modelManifestHash does not match manifest hash."
  );
  assert(arb.modelManifestHash === manifestHash, "Pinned Model failed: ARB modelManifestHash does not match manifest hash.");
  assert(
    arb.modelPinningMode === manifest.modelPinningMode,
    "Pinned Model failed: ARB modelPinningMode does not match manifest mode."
  );

  const secondProvenance = generateSourceProvenanceReceipt(rawSnapshot, normalized, {
    modelManifest: manifest,
    privacyTransformedSnapshot: featureOnly,
  });
  const secondArb = buildArb({
    recommendation,
    sourceProvenance: secondProvenance,
    privacyPolicyId: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    modelManifest: manifest,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const deterministic = canonicalJson(arb) === canonicalJson(secondArb);
  assert(deterministic, "Pinned Model failed: pinned-model ARB output is not deterministic.");

  const tamperedArb = {
    ...arb,
    modelManifestHash: getPinnedModelManifestHash(
      buildPinnedModelManifest({
        environmentId: "tampered-runtime-v1",
      })
    ),
  };
  const verifyTampered = verifyArb({
    arb: tamperedArb,
    sourceProvenance: provenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(!verifyTampered.ok, "Pinned Model failed: tampered model manifest hash should be rejected.");

  const artifact = {
    schemaVersion: "pinned-model-v1",
    manifest,
    manifestHash,
    provenanceBinding: {
      modelManifestHash: provenance.executionContext.modelManifestHash,
      modelPinningMode: provenance.executionContext.modelPinningMode,
    },
    arbBinding: {
      modelManifestHash: arb.modelManifestHash,
      modelPinningMode: arb.modelPinningMode,
    },
    verification: {
      pass: verifyPass,
      tamperedRejected: !verifyTampered.ok,
      tamperedErrors: verifyTampered.errors,
    },
    deterministic,
    doneCondition:
      "The recommendation pipeline now uses a pinned model manifest: provenance and ARB bind the exact manifest hash and tampering with the model binding is rejected by verification.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Pinned Model artifact: ${ARTIFACT_PATH}`);
  console.log(`Model manifest hash: ${manifestHash}`);
  console.log(`Tampered manifest rejected: ${!verifyTampered.ok}`);
  console.log("Pinned Model test: PASS");
}

main().catch((error) => {
  console.error("Pinned Model test failed.", error);
  process.exitCode = 1;
});



