import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step13.attestation-boundary.json");
const FIXED_DEV_SIGNING_KEY = "step13-dev-signing-key";
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
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const secondRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const firstVerify = verifyArb({
    arb: firstRun.arb,
    sourceProvenance: firstRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(firstVerify.ok, `Step13 verification failed: ${firstVerify.errors.join(" | ")}`);

  assert(firstRun.arb.attestation, "Step13 failed: ARB is missing attestation evidence.");
  assert(firstRun.sourceProvenance.executionContext.enclaveProviderId, "Step13 failed: missing enclaveProviderId.");
  assert(firstRun.sourceProvenance.executionContext.attestationHash, "Step13 failed: missing attestationHash.");
  assert(
    firstRun.sourceProvenance.executionContext.enclaveProviderId === firstRun.arb.attestation?.providerId,
    "Step13 failed: provenance provider does not match ARB attestation provider."
  );
  assert(
    firstRun.runSummary.attestation.quoteHash === firstRun.arb.attestation?.quoteHash,
    "Step13 failed: run summary quoteHash does not match ARB attestation."
  );

  const deterministic = canonicalJson(firstRun.arb) === canonicalJson(secondRun.arb);
  assert(deterministic, "Step13 failed: ARB output is not deterministic for identical inputs.");

  const artifact = {
    schemaVersion: "step13-attestation-boundary-v1",
    issuedAt: FIXED_ISSUED_AT,
    provider: {
      providerId: firstRun.arb.attestation?.providerId || null,
      executionMode: firstRun.arb.attestation?.executionMode || null,
      quoteHash: firstRun.arb.attestation?.quoteHash || null,
      measurement: firstRun.arb.attestation?.measurement || null,
    },
    provenanceExecutionContext: firstRun.sourceProvenance.executionContext,
    verifyResult: firstVerify,
    deterministic,
    doneCondition:
      "ARB carries attestation evidence, provenance is linked to that attestation, verification passes, and output is deterministic.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Step 13 artifact: ${ARTIFACT_PATH}`);
  console.log(`Attestation provider: ${firstRun.arb.attestation?.providerId}`);
  console.log("Step 13 attestation boundary test: PASS");
}

main().catch((error) => {
  console.error("Step 13 attestation boundary test failed.", error);
  process.exitCode = 1;
});
