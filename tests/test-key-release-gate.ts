import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import {
  simulatedTeeEnclaveProvider,
  verifiedTeeEnclaveProvider,
} from "../src/arb/enclave/provider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";
import type { KeyReleasePolicy } from "../src/arb/keyReleasePolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "key-release-gate.json");
const FIXED_DEV_SIGNING_KEY = "key-release-gate-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }

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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function main(): Promise<void> {
  const rawSnapshot = getMockLightningSnapshot();

  const sampleVerifiedAttestation = await verifiedTeeEnclaveProvider.attest({
    issuedAt: FIXED_ISSUED_AT,
    nonce: "a".repeat(64),
    inputHash: "b".repeat(64),
    outputHash: "c".repeat(64),
    moduleOrder: ["normalize_snapshot", "privacy_transform", "score_node_state", "arb_signer"],
  });

  const strictPolicy: KeyReleasePolicy = {
    schemaVersion: "key-release-policy-v1",
    keyId: "arb-signer-verified-v1",
    minExecutionMode: "tee_verified",
    requireAttestation: true,
    allowedProviderIds: [verifiedTeeEnclaveProvider.providerId],
    allowedMeasurements: [sampleVerifiedAttestation.measurement],
    allowedQuoteFormats: ["simulated_quote"],
  };

  const verifiedRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    keyReleasePolicy: strictPolicy,
    enclaveProvider: verifiedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifiedArbCheck = verifyArb({
    arb: verifiedRun.arb,
    sourceProvenance: verifiedRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifiedArbCheck.ok, `Key Release Gate verified path failed ARB verification: ${verifiedArbCheck.errors.join(" | ")}`);
  assert(
    verifiedRun.runSummary.keyRelease.policyApplied && verifiedRun.runSummary.keyRelease.granted,
    "Key Release Gate verified path did not report granted key release."
  );

  let deniedMessage = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      devSigningKey: FIXED_DEV_SIGNING_KEY,
      keyReleasePolicy: strictPolicy,
      enclaveProvider: simulatedTeeEnclaveProvider,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    deniedMessage = error instanceof Error ? error.message : String(error);
  }
  assert(deniedMessage.includes("Key release denied:"), "Key Release Gate expected simulated path key release denial.");

  const verifiedRunAgain = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    keyReleasePolicy: strictPolicy,
    enclaveProvider: verifiedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const deterministic = canonicalJson(verifiedRun.arb) === canonicalJson(verifiedRunAgain.arb);
  assert(deterministic, "Key Release Gate failed: verified path ARB output is not deterministic.");

  const artifact = {
    schemaVersion: "key-release-gate-v1",
    policy: strictPolicy,
    verifiedPath: {
      providerId: verifiedRun.arb.attestation?.providerId || null,
      executionMode: verifiedRun.arb.attestation?.executionMode || null,
      keyRelease: verifiedRun.runSummary.keyRelease,
      verifyArb: verifiedArbCheck,
    },
    simulatedPath: {
      providerId: simulatedTeeEnclaveProvider.providerId,
      denied: deniedMessage.includes("Key release denied:"),
      error: deniedMessage || null,
    },
    deterministic,
    doneCondition:
      "Key release is gated by strict attestation policy: tee_verified is granted signing, tee_simulated is denied.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Key Release Gate artifact: ${ARTIFACT_PATH}`);
  console.log(`Verified key release granted: ${verifiedRun.runSummary.keyRelease.granted}`);
  console.log(`Simulated key release denied: ${deniedMessage.includes("Key release denied:")}`);
  console.log("Key Release Gate test: PASS");
}

main().catch((error) => {
  console.error("Key Release Gate test failed.", error);
  process.exitCode = 1;
});


