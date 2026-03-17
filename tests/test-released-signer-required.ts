import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { verifyArb } from "../src/arb/verifyArb";
import { StaticKeyringSigningKeyProvider } from "../src/arb/enclave/signingKeyProvider";
import type { KeyReleasePolicy } from "../src/arb/keyReleasePolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "released-signer-required.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";
const DECOY_DEV_KEY = "released-signer-required-decoy-dev-signing-key-not-used";

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

  const enclaveProvider = await createPhalaCliEnclaveProviderFromArtifacts({
    cvmInfoPath,
    cliAttestationPath,
  });

  const releasedKeyId = "arb-signer-phala-tdx-v1";
  const releasedKeyMaterial = "released-signer-required-released-signing-key-material";
  const signingKeyProvider = new StaticKeyringSigningKeyProvider({
    providerId: "phala-key-release-provider-v1",
    keyring: {
      [releasedKeyId]: releasedKeyMaterial,
    },
  });

  const keyReleasePolicy: KeyReleasePolicy = {
    schemaVersion: "key-release-policy-v1",
    keyId: releasedKeyId,
    minExecutionMode: "tee_verified",
    requireAttestation: true,
    allowedProviderIds: [enclaveProvider.providerId],
    allowedQuoteFormats: ["tdx_quote"],
  };

  const rawSnapshot = getMockLightningSnapshot();

  const firstRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    requireReleasedSigningKey: true,
    keyReleasePolicy,
    signingKeyProvider,
    enclaveProvider,
    devSigningKey: DECOY_DEV_KEY,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const secondRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    requireReleasedSigningKey: true,
    keyReleasePolicy,
    signingKeyProvider,
    enclaveProvider,
    devSigningKey: DECOY_DEV_KEY,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: firstRun.arb,
    sourceProvenance: firstRun.sourceProvenance,
    devSigningKey: releasedKeyMaterial,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyResult.ok, `Released Signer Required verifyArb failed: ${verifyResult.errors.join(" | ")}`);

  assert(firstRun.runSummary.keyRelease.releasedSignerRequired, "Released Signer Required failed: release-required flag not set.");
  assert(firstRun.runSummary.keyRelease.releasedSignerUsed, "Released Signer Required failed: released signer was not used.");
  assert(
    firstRun.runSummary.keyRelease.keySource === signingKeyProvider.providerId,
    "Released Signer Required failed: key source should be the signing key provider."
  );

  const deterministic = canonicalJson(firstRun.arb) === canonicalJson(secondRun.arb);
  assert(deterministic, "Released Signer Required failed: ARB output is not deterministic for fixed inputs.");

  let missingProviderError = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      requireReleasedSigningKey: true,
      keyReleasePolicy,
      enclaveProvider,
      devSigningKey: DECOY_DEV_KEY,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    missingProviderError = error instanceof Error ? error.message : String(error);
  }
  assert(
    missingProviderError.includes("Released signer required:"),
    "Released Signer Required failed: missing signingKeyProvider should be rejected in release-required mode."
  );

  let missingKeyIdError = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      requireReleasedSigningKey: true,
      signingKeyProvider,
      enclaveProvider,
      devSigningKey: DECOY_DEV_KEY,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    missingKeyIdError = error instanceof Error ? error.message : String(error);
  }
  assert(
    missingKeyIdError.includes("Released signer required:"),
    "Released Signer Required failed: missing keyReleasePolicy/keyId should be rejected in release-required mode."
  );

  const artifact = {
    schemaVersion: "released-signer-required-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    passRun: {
      keyRelease: firstRun.runSummary.keyRelease,
      verifyArb: verifyResult,
    },
    rejectedRuns: {
      missingProvider: {
        rejected: missingProviderError.includes("Released signer required:"),
        error: missingProviderError || null,
      },
      missingKeyId: {
        rejected: missingKeyIdError.includes("Released signer required:"),
        error: missingKeyIdError || null,
      },
    },
    deterministic,
    doneCondition:
      "Pipeline can enforce released-signer-only mode: signing succeeds only through key-release provider and rejects direct dev key fallback paths.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Released Signer Required artifact: ${ARTIFACT_PATH}`);
  console.log(`Released signer used: ${firstRun.runSummary.keyRelease.releasedSignerUsed}`);
  console.log(`Missing provider rejected: ${missingProviderError.includes("Released signer required:")}`);
  console.log(`Missing keyId rejected: ${missingKeyIdError.includes("Released signer required:")}`);
  console.log("Released Signer Required test: PASS");
}

main().catch((error) => {
  console.error("Released Signer Required test failed.", error);
  process.exitCode = 1;
});



