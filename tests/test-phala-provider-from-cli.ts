import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { verifyArb } from "../src/arb/verifyArb";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-provider-from-cli.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");

const FIXED_DEV_SIGNING_KEY = "phala-provider-from-cli-dev-signing-key";
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
  const cvmInfoPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_CVM_INFO_PATH;
  const cliAttestationPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_CLI_ATTEST_PATH;

  const provider = await createPhalaCliEnclaveProviderFromArtifacts({
    cvmInfoPath,
    cliAttestationPath,
  });

  const rawSnapshot = getMockLightningSnapshot();

  const firstRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: provider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const secondRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider: provider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: firstRun.arb,
    sourceProvenance: firstRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });

  assert(verifyResult.ok, `Phala Provider From Cli verifyArb failed: ${verifyResult.errors.join(" | ")}`);
  assert(firstRun.arb.attestation, "Phala Provider From Cli failed: ARB is missing attestation evidence.");
  assert(
    firstRun.arb.attestation?.providerId === provider.providerId,
    "Phala Provider From Cli failed: ARB attestation providerId does not match Phala CLI provider."
  );
  assert(
    firstRun.arb.attestation?.executionMode === "tee_verified",
    "Phala Provider From Cli failed: ARB attestation execution mode is not tee_verified."
  );
  assert(
    firstRun.sourceProvenance.executionContext.executionMode === "tee_verified",
    "Phala Provider From Cli failed: provenance execution mode must be tee_verified."
  );
  assert(
    firstRun.sourceProvenance.executionContext.enclaveProviderId === provider.providerId,
    "Phala Provider From Cli failed: provenance enclaveProviderId does not match provider."
  );

  const deterministic = canonicalJson(firstRun.arb) === canonicalJson(secondRun.arb);
  assert(deterministic, "Phala Provider From Cli failed: ARB output is not deterministic for fixed inputs.");

  const artifact = {
    schemaVersion: "phala-provider-from-cli-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    provider: {
      providerId: provider.providerId,
      executionMode: provider.executionMode,
      sourceSummary: provider.sourceSummary,
    },
    run: {
      attestation: {
        providerId: firstRun.arb.attestation?.providerId || null,
        executionMode: firstRun.arb.attestation?.executionMode || null,
        quoteHash: firstRun.arb.attestation?.quoteHash || null,
        measurement: firstRun.arb.attestation?.measurement || null,
      },
      verifyArb: verifyResult,
      deterministic,
    },
    doneCondition:
      "Pipeline uses Phala CLI-backed enclave provider evidence to produce a tee_verified ARB that passes verification and remains deterministic for fixed inputs.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Phala Provider From Cli artifact: ${ARTIFACT_PATH}`);
  console.log(`Provider: ${provider.providerId}`);
  console.log("Phala Provider From Cli test: PASS");
}

main().catch((error) => {
  console.error("Phala Provider From Cli test failed.", error);
  process.exitCode = 1;
});


