import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";
import type { KeyReleasePolicy } from "../src/arb/keyReleasePolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step20.attestation-quote-formats.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");
const FIXED_DEV_SIGNING_KEY = "step20-dev-signing-key";
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

  const allowTdxPolicy: KeyReleasePolicy = {
    schemaVersion: "key-release-policy-v1",
    keyId: "arb-signer-phala-tdx-v1",
    minExecutionMode: "tee_verified",
    requireAttestation: true,
    allowedProviderIds: [provider.providerId],
    allowedQuoteFormats: ["tdx_quote"],
  };

  const tdxRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    keyReleasePolicy: allowTdxPolicy,
    enclaveProvider: provider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: tdxRun.arb,
    sourceProvenance: tdxRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyResult.ok, `Step20 verifyArb failed: ${verifyResult.errors.join(" | ")}`);
  assert(tdxRun.arb.attestation, "Step20 failed: ARB is missing attestation evidence.");
  assert(
    tdxRun.arb.attestation?.quoteFormat === "tdx_quote",
    `Step20 failed: expected tdx_quote but got ${tdxRun.arb.attestation?.quoteFormat || "null"}.`
  );
  assert(tdxRun.runSummary.keyRelease.granted, "Step20 failed: key release should be granted for tdx_quote policy.");

  const denyTdxPolicy: KeyReleasePolicy = {
    ...allowTdxPolicy,
    keyId: "arb-signer-deny-tdx-v1",
    allowedQuoteFormats: ["simulated_quote"],
  };

  let deniedMessage = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      devSigningKey: FIXED_DEV_SIGNING_KEY,
      keyReleasePolicy: denyTdxPolicy,
      enclaveProvider: provider,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    deniedMessage = error instanceof Error ? error.message : String(error);
  }
  assert(deniedMessage.includes("Key release denied:"), "Step20 failed: expected quote format policy denial.");

  const tdxRunAgain = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    keyReleasePolicy: allowTdxPolicy,
    enclaveProvider: provider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const deterministic = canonicalJson(tdxRun.arb) === canonicalJson(tdxRunAgain.arb);
  assert(deterministic, "Step20 failed: ARB output is not deterministic for fixed inputs.");

  const artifact = {
    schemaVersion: "step20-attestation-quote-formats-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    provider: {
      providerId: provider.providerId,
      executionMode: provider.executionMode,
      quoteFormat: provider.quoteFormat,
    },
    allowedTdxPolicy: {
      allowedQuoteFormats: allowTdxPolicy.allowedQuoteFormats,
      keyReleaseGranted: tdxRun.runSummary.keyRelease.granted,
      verifyArb: verifyResult,
    },
    deniedPolicy: {
      allowedQuoteFormats: denyTdxPolicy.allowedQuoteFormats,
      denied: deniedMessage.includes("Key release denied:"),
      error: deniedMessage || null,
    },
    deterministic,
    doneCondition:
      "ARB attestation supports real tdx_quote format: verification passes, tdx-only key policy grants signing, and simulated-only policy rejects the same attestation.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Step 20 artifact: ${ARTIFACT_PATH}`);
  console.log(`Provider quote format: ${provider.quoteFormat}`);
  console.log(`Simulated-only policy rejected: ${deniedMessage.includes("Key release denied:")}`);
  console.log("Step 20 attestation quote-format test: PASS");
}

main().catch((error) => {
  console.error("Step 20 attestation quote-format test failed.", error);
  process.exitCode = 1;
});
