import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { buildEnclaveCandidateContractsDocument, ENCLAVE_CANDIDATE_IDS } from "../src/arb/enclave/manifest";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "enclave-candidates.contracts.json");
const FIXED_DEV_SIGNING_KEY = "step12-dev-signing-key";
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
  const contracts = buildEnclaveCandidateContractsDocument();
  const contractIds = contracts.candidateModules.map((module) => module.moduleId);

  assert(
    contractIds.length === ENCLAVE_CANDIDATE_IDS.length,
    `Expected ${ENCLAVE_CANDIDATE_IDS.length} enclave modules, got ${contractIds.length}.`
  );

  for (const requiredId of ENCLAVE_CANDIDATE_IDS) {
    assert(
      contractIds.includes(requiredId),
      `Missing required enclave candidate module contract: ${requiredId}`
    );
  }

  const mockSnapshot = getMockLightningSnapshot();
  const boundaryRun = await runEnclaveBoundaryPipeline({
    rawSnapshot: mockSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: boundaryRun.arb,
    sourceProvenance: boundaryRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });

  assert(verifyResult.ok, `Boundary run ARB verification failed: ${verifyResult.errors.join(" | ")}`);

  const artifact = {
    schemaVersion: "enclave-candidates-artifact-v1",
    contracts,
    smokeTest: {
      schemaVersion: "enclave-candidates-smoke-test-v1",
      testMode: "mock_snapshot",
      privacyMode: "feature_only",
      moduleOrder: boundaryRun.runSummary.moduleOrder,
      hashes: {
        normalizedSnapshotHash: boundaryRun.runSummary.normalize.normalizedSnapshotHash,
        privacyOutputHash: boundaryRun.runSummary.privacy.privacyOutputHash,
        recommendationHash: boundaryRun.runSummary.score.recommendationHash,
        arbHash: boundaryRun.runSummary.sign.arbHash,
      },
      modelVersion: boundaryRun.runSummary.score.modelVersion,
      signatureDigest: boundaryRun.runSummary.sign.signatureDigest,
      arbVerification: verifyResult,
    },
    doneCondition:
      "All four enclave candidate modules are contract-defined with deterministic I/O and pass local boundary smoke verification.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved enclave contracts artifact: ${ARTIFACT_PATH}`);
  console.log(`Candidate modules: ${contractIds.join(", ")}`);
  console.log(`Boundary smoke verification: PASS`);
}

main().catch((error) => {
  console.error("Failed to export enclave contracts artifact.", error);
  process.exitCode = 1;
});
