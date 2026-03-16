import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";
import { evaluateArbAttestationPolicy } from "../src/arb/attestationPolicy";
import type { AttestationPolicy } from "../src/arb/attestationPolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step22.strict-attestation-policy.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");
const FIXED_DEV_SIGNING_KEY = "step22-dev-signing-key";
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
  const cvmInfoPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_CVM_INFO_PATH;
  const cliAttestationPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_CLI_ATTEST_PATH;

  const enclaveProvider = await createPhalaCliEnclaveProviderFromArtifacts({
    cvmInfoPath,
    cliAttestationPath,
  });

  const run = await runEnclaveBoundaryPipeline({
    rawSnapshot: getMockLightningSnapshot(),
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: run.arb,
    sourceProvenance: run.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyResult.ok, `Step22 verifyArb failed: ${verifyResult.errors.join(" | ")}`);

  const attestation = run.arb.attestation;
  assert(attestation, "Step22 failed: ARB is missing attestation evidence.");

  const strictPolicy: AttestationPolicy = {
    schemaVersion: "attestation-policy-v1" as const,
    minExecutionMode: "tee_verified" as const,
    requireAttestation: true,
    allowedProviderIds: [attestation.providerId],
    allowedMeasurements: [attestation.measurement],
    allowedQuoteFormats: [attestation.quoteFormat],
  };

  const strictPolicyResult = evaluateArbAttestationPolicy({
    arb: run.arb,
    sourceProvenance: run.sourceProvenance,
    policy: strictPolicy,
  });
  assert(
    strictPolicyResult.ok,
    `Step22 strict policy should pass but failed: ${strictPolicyResult.errors.join(" | ")}`
  );

  const wrongMeasurementPolicyResult = evaluateArbAttestationPolicy({
    arb: run.arb,
    sourceProvenance: run.sourceProvenance,
    policy: {
      ...strictPolicy,
      allowedMeasurements: ["0".repeat(64)],
    },
  });
  assert(
    !wrongMeasurementPolicyResult.ok,
    "Step22 failed: wrong-measurement policy should reject this ARB."
  );

  const wrongQuotePolicyResult = evaluateArbAttestationPolicy({
    arb: run.arb,
    sourceProvenance: run.sourceProvenance,
    policy: {
      ...strictPolicy,
      allowedQuoteFormats: ["simulated_quote"],
    },
  });
  assert(!wrongQuotePolicyResult.ok, "Step22 failed: wrong-quote-format policy should reject this ARB.");

  const wrongProviderPolicyResult = evaluateArbAttestationPolicy({
    arb: run.arb,
    sourceProvenance: run.sourceProvenance,
    policy: {
      ...strictPolicy,
      allowedProviderIds: ["not-allowed-provider"],
    },
  });
  assert(!wrongProviderPolicyResult.ok, "Step22 failed: wrong-provider policy should reject this ARB.");

  const artifact = {
    schemaVersion: "step22-strict-attestation-policy-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    strictPolicy,
    results: {
      verifyArb: verifyResult,
      strictPolicy: strictPolicyResult,
      wrongMeasurementPolicy: wrongMeasurementPolicyResult,
      wrongQuotePolicy: wrongQuotePolicyResult,
      wrongProviderPolicy: wrongProviderPolicyResult,
    },
    doneCondition:
      "Strict production-style attestation policy enforces provider, measurement, and quote format allow-lists; only fully matching ARBs are accepted.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Step 22 artifact: ${ARTIFACT_PATH}`);
  console.log(`Strict policy pass: ${strictPolicyResult.ok}`);
  console.log(`Wrong measurement rejected: ${!wrongMeasurementPolicyResult.ok}`);
  console.log(`Wrong quote format rejected: ${!wrongQuotePolicyResult.ok}`);
  console.log(`Wrong provider rejected: ${!wrongProviderPolicyResult.ok}`);
  console.log("Step 22 strict attestation policy test: PASS");
}

main().catch((error) => {
  console.error("Step 22 strict attestation policy test failed.", error);
  process.exitCode = 1;
});
