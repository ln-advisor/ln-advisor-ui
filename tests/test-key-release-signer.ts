import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { verifyArb } from "../src/arb/verifyArb";
import { StaticKeyringSigningKeyProvider } from "../src/arb/enclave/signingKeyProvider";
import type { KeyReleasePolicy } from "../src/arb/keyReleasePolicy";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "key-release-signer.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");
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

  const enclaveProvider = await createPhalaCliEnclaveProviderFromArtifacts({
    cvmInfoPath,
    cliAttestationPath,
  });

  const releasedKeyId = "arb-signer-phala-tdx-v1";
  const releasedKeyMaterial = "key-release-signer-released-signing-key-material";
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
    keyReleasePolicy,
    signingKeyProvider,
    enclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const secondRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    keyReleasePolicy,
    signingKeyProvider,
    enclaveProvider,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb: firstRun.arb,
    sourceProvenance: firstRun.sourceProvenance,
    devSigningKey: releasedKeyMaterial,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyResult.ok, `Key Release Signer verifyArb failed: ${verifyResult.errors.join(" | ")}`);
  assert(firstRun.runSummary.keyRelease.granted, "Key Release Signer failed: key release should be granted.");
  assert(
    firstRun.runSummary.keyRelease.keyId === releasedKeyId,
    "Key Release Signer failed: granted keyId does not match policy keyId."
  );
  assert(
    firstRun.runSummary.keyRelease.keySource === signingKeyProvider.providerId,
    "Key Release Signer failed: key source should be the signing key provider."
  );

  const deterministic = canonicalJson(firstRun.arb) === canonicalJson(secondRun.arb);
  assert(deterministic, "Key Release Signer failed: ARB output is not deterministic for fixed inputs.");

  let missingKeyError = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      keyReleasePolicy,
      enclaveProvider,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    missingKeyError = error instanceof Error ? error.message : String(error);
  }
  assert(
    missingKeyError.includes("Signing key unavailable:"),
    "Key Release Signer failed: missing signer provider should be rejected."
  );

  const artifact = {
    schemaVersion: "key-release-signer-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    keyReleasePolicy,
    releasedSigner: {
      providerId: signingKeyProvider.providerId,
      keyId: firstRun.runSummary.keyRelease.keyId,
      keySource: firstRun.runSummary.keyRelease.keySource,
      granted: firstRun.runSummary.keyRelease.granted,
      verifyArb: verifyResult,
    },
    missingSignerCase: {
      rejected: missingKeyError.includes("Signing key unavailable:"),
      error: missingKeyError || null,
    },
    deterministic,
    doneCondition:
      "ARB signing key is released through policy-gated key provider under tee_verified attestation, and pipeline rejects runs without releasable signing key material.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Key Release Signer artifact: ${ARTIFACT_PATH}`);
  console.log(`Released signing key source: ${firstRun.runSummary.keyRelease.keySource}`);
  console.log(`Missing signer rejected: ${missingKeyError.includes("Signing key unavailable:")}`);
  console.log("Key Release Signer test: PASS");
}

main().catch((error) => {
  console.error("Key Release Signer test failed.", error);
  process.exitCode = 1;
});


