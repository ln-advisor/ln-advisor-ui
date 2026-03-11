import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { simulatedTeeEnclaveProvider } from "../src/arb/enclave/provider";
import { verifyArb } from "../src/arb/verifyArb";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step14.tee-simulated.json");
const FIXED_DEV_SIGNING_KEY = "step14-dev-signing-key";
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
  const firstRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: simulatedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const secondRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: simulatedTeeEnclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: firstRun.arb,
    sourceProvenance: firstRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyResult.ok, `Step14 verification failed: ${verifyResult.errors.join(" | ")}`);

  assert(firstRun.arb.attestation, "Step14 failed: ARB is missing attestation evidence.");
  assert(
    firstRun.arb.attestation?.executionMode === "tee_simulated",
    "Step14 failed: attestation execution mode is not tee_simulated."
  );
  assert(
    firstRun.sourceProvenance.executionContext.executionMode === "tee_candidate",
    "Step14 failed: provenance execution mode should map tee_simulated -> tee_candidate."
  );
  assert(
    firstRun.sourceProvenance.executionContext.enclaveProviderId === simulatedTeeEnclaveProvider.providerId,
    "Step14 failed: provenance provider does not match simulated TEE provider."
  );
  assert(
    firstRun.runSummary.attestation.providerId === simulatedTeeEnclaveProvider.providerId,
    "Step14 failed: run summary provider mismatch."
  );

  const deterministic = canonicalJson(firstRun.arb) === canonicalJson(secondRun.arb);
  assert(deterministic, "Step14 failed: ARB output is not deterministic for identical inputs.");

  const artifact = {
    schemaVersion: "step14-tee-simulated-v1",
    issuedAt: FIXED_ISSUED_AT,
    provider: {
      providerId: firstRun.arb.attestation?.providerId || null,
      executionMode: firstRun.arb.attestation?.executionMode || null,
      measurement: firstRun.arb.attestation?.measurement || null,
      quoteHash: firstRun.arb.attestation?.quoteHash || null,
    },
    provenanceExecutionContext: firstRun.sourceProvenance.executionContext,
    verifyResult,
    deterministic,
    doneCondition:
      "Pipeline runs through tee_simulated provider, provenance maps to tee_candidate mode, verification passes, and outputs stay deterministic.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Step 14 artifact: ${ARTIFACT_PATH}`);
  console.log(`TEE provider: ${firstRun.arb.attestation?.providerId}`);
  console.log("Step 14 tee-simulated test: PASS");
}

main().catch((error) => {
  console.error("Step 14 tee-simulated test failed.", error);
  process.exitCode = 1;
});
