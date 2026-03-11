import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import {
  simulatedTeeEnclaveProvider,
  verifiedTeeEnclaveProvider,
} from "../src/arb/enclave/provider";
import { verifyArb } from "../src/arb/verifyArb";
import { evaluateArbAttestationPolicy } from "../src/arb/attestationPolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step15.tee-verified-policy.json");
const FIXED_DEV_SIGNING_KEY = "step15-dev-signing-key";
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

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function main(): Promise<void> {
  const rawSnapshot = getMockLightningSnapshot();
  const policy = {
    schemaVersion: "attestation-policy-v1" as const,
    minExecutionMode: "tee_verified" as const,
    requireAttestation: true,
    allowedProviderIds: [verifiedTeeEnclaveProvider.providerId],
  };

  const verifiedRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: verifiedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const verifiedVerifyResult = verifyArb({
    arb: verifiedRun.arb,
    sourceProvenance: verifiedRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifiedVerifyResult.ok, `Step15 verifyArb failed: ${verifiedVerifyResult.errors.join(" | ")}`);

  const verifiedPolicyResult = evaluateArbAttestationPolicy({
    arb: verifiedRun.arb,
    sourceProvenance: verifiedRun.sourceProvenance,
    policy,
  });
  assert(
    verifiedPolicyResult.ok,
    `Step15 policy failed for verified run: ${verifiedPolicyResult.errors.join(" | ")}`
  );

  const simulatedRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: simulatedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const simulatedPolicyResult = evaluateArbAttestationPolicy({
    arb: simulatedRun.arb,
    sourceProvenance: simulatedRun.sourceProvenance,
    policy,
  });
  assert(!simulatedPolicyResult.ok, "Step15 expected tee_simulated run to fail tee_verified policy.");

  const artifact = {
    schemaVersion: "step15-tee-verified-policy-v1",
    policy,
    verifiedRun: {
      providerId: verifiedRun.arb.attestation?.providerId || null,
      executionMode: verifiedRun.arb.attestation?.executionMode || null,
      provenanceMode: verifiedRun.sourceProvenance.executionContext.executionMode,
      verifyArb: verifiedVerifyResult,
      policyResult: verifiedPolicyResult,
    },
    simulatedRun: {
      providerId: simulatedRun.arb.attestation?.providerId || null,
      executionMode: simulatedRun.arb.attestation?.executionMode || null,
      provenanceMode: simulatedRun.sourceProvenance.executionContext.executionMode,
      policyResult: simulatedPolicyResult,
    },
    doneCondition:
      "tee_verified ARB passes strict attestation policy while tee_simulated ARB is rejected by the same policy.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Step 15 artifact: ${ARTIFACT_PATH}`);
  console.log(`Verified provider: ${verifiedRun.arb.attestation?.providerId}`);
  console.log(`Simulated provider rejected by policy: ${!simulatedPolicyResult.ok}`);
  console.log("Step 15 tee-verified policy test: PASS");
}

main().catch((error) => {
  console.error("Step 15 tee-verified policy test failed.", error);
  process.exitCode = 1;
});
