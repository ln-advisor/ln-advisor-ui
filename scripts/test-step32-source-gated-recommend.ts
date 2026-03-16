import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApiServer, type ApiServerOptions } from "../src/api/server";
import type { ArbBundle } from "../src/arb/buildArb";
import type { SourceProvenanceReceipt } from "../src/arb/provenance";
import { verifyArb } from "../src/arb/verifyArb";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import type { VerifyPhalaAttestationBySourceResult } from "../src/tee/phala";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step32.source-gated-recommend.json");
const MISSING_PORT = 8792;
const PASS_PORT = 8793;
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";
const RELEASED_KEY_ID = "arb-signer-step32-v1";
const RELEASED_SIGNING_KEY = "step32-released-signing-key-material";
const DECOY_DEV_KEY = "step32-decoy-dev-key";
const KEY_PROVIDER_ID = "step32-signing-provider-v1";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
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
const stableJson = (value: unknown): string => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const trackedEnvKeys = [
  "API_REQUIRE_RELEASED_SIGNER",
  "API_RELEASED_SIGNER_KEY_ID",
  "API_RELEASED_SIGNER_KEYRING_JSON",
  "API_RELEASED_SIGNER_KEY_PROVIDER_ID",
  "API_RELEASED_SIGNER_ENCLAVE_PROVIDER",
  "API_RELEASED_SIGNER_MIN_EXECUTION_MODE",
  "API_RELEASED_SIGNER_ALLOWED_PROVIDER_IDS",
  "API_RELEASED_SIGNER_ALLOWED_QUOTE_FORMATS",
  "PHALA_API_KEY",
  "PHALA_CVM_ID",
  "PHALA_APP_BASE_URL",
  "PHALA_ATTESTATION_SOURCE",
  "PHALA_EXPECTED_REPORT_DATA_HEX",
  "ARB_DEV_SIGNING_KEY",
  "ARB_TTL_SECONDS",
] as const;

type TrackedEnvKey = (typeof trackedEnvKeys)[number];

const captureEnv = (): Record<TrackedEnvKey, string | undefined> => {
  const captured = {} as Record<TrackedEnvKey, string | undefined>;
  for (const key of trackedEnvKeys) captured[key] = process.env[key];
  return captured;
};

const restoreEnv = (captured: Record<TrackedEnvKey, string | undefined>): void => {
  for (const key of trackedEnvKeys) {
    const value = captured[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
};

async function postJson(
  url: string,
  payload: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

const mockSourceVerification: VerifyPhalaAttestationBySourceResult = {
  schemaVersion: "phala-attestation-source-verification-v1",
  source: "cloud_cvm_attestation",
  ok: true,
  checks: {
    quoteVerifiedByPhalaApi: true,
    composeHashMatchesRtmr3Event: null,
    reportDataMatchesExpected: true,
  },
  attestation: {
    quoteFormat: "simulated_quote",
    quoteHex: "ab".repeat(256),
    reportData: "cd".repeat(32),
    composeHashFromInfo: null,
    composeHashFromEventLog: null,
  },
  verifier: {
    docs: {
      verifyYourApplication: "https://docs.phala.com/phala-cloud/attestation/verify-your-application",
      verifyThePlatform: "https://docs.phala.com/phala-cloud/attestation/verify-the-platform",
      attestationApiReference: "https://docs.phala.com/phala-cloud/phala-cloud-api/attestations",
    },
    note: "step32 mock source verification",
  },
};

const sourceVerificationRuntime: ApiServerOptions["sourceVerificationRuntime"] = {
  schemaVersion: "api-source-verification-runtime-v1",
  source: "cloud_cvm_attestation",
  gatePolicy: {
    schemaVersion: "attestation-verification-gate-policy-v1",
    requireSourceVerification: true,
    requireVerifiedQuote: true,
    allowedSources: ["cloud_cvm_attestation"],
    requireAppComposeBindingForAppSource: true,
    requireReportDataMatchWhenExpected: true,
  },
  resolve: async () => mockSourceVerification,
};

async function main(): Promise<void> {
  const telemetry = snapshotToFrontendTelemetry(getMockLightningSnapshot());
  const envSnapshot = captureEnv();

  process.env.API_REQUIRE_RELEASED_SIGNER = "true";
  process.env.API_RELEASED_SIGNER_KEY_ID = RELEASED_KEY_ID;
  process.env.API_RELEASED_SIGNER_KEYRING_JSON = JSON.stringify({
    [RELEASED_KEY_ID]: RELEASED_SIGNING_KEY,
  });
  process.env.API_RELEASED_SIGNER_KEY_PROVIDER_ID = KEY_PROVIDER_ID;
  process.env.API_RELEASED_SIGNER_ENCLAVE_PROVIDER = "verified_tee";
  process.env.API_RELEASED_SIGNER_MIN_EXECUTION_MODE = "tee_verified";
  process.env.API_RELEASED_SIGNER_ALLOWED_PROVIDER_IDS = "verified-tee-enclave-provider";
  process.env.API_RELEASED_SIGNER_ALLOWED_QUOTE_FORMATS = "simulated_quote";
  process.env.ARB_DEV_SIGNING_KEY = DECOY_DEV_KEY;
  process.env.ARB_TTL_SECONDS = "86400";
  delete process.env.PHALA_API_KEY;
  delete process.env.PHALA_CVM_ID;
  delete process.env.PHALA_APP_BASE_URL;
  delete process.env.PHALA_ATTESTATION_SOURCE;
  delete process.env.PHALA_EXPECTED_REPORT_DATA_HEX;

  const requestPayload = {
    telemetry,
    privacyMode: "feature_only",
    issuedAt: FIXED_ISSUED_AT,
  };

  const missingServer = createApiServer();
  await new Promise<void>((resolve) => missingServer.listen(MISSING_PORT, resolve));

  try {
    const missingSourceResponse = await postJson(
      `http://127.0.0.1:${MISSING_PORT}/api/recommend`,
      requestPayload
    );
    const missingSourceError =
      typeof missingSourceResponse.body.error === "string" ? missingSourceResponse.body.error : "";
    const missingSourceRejected =
      missingSourceResponse.status >= 500 &&
      missingSourceError.includes("Missing required environment variable: PHALA_API_KEY");

    assert(
      missingSourceRejected,
      "Step32 failed: strict recommend should fail closed when source verification runtime is not configured."
    );

    const passServer = createApiServer({
      sourceVerificationRuntime,
    });
    await new Promise<void>((resolve) => passServer.listen(PASS_PORT, resolve));

    try {
      const firstPassResponse = await postJson(`http://127.0.0.1:${PASS_PORT}/api/recommend`, requestPayload);
      const secondPassResponse = await postJson(`http://127.0.0.1:${PASS_PORT}/api/recommend`, requestPayload);

      assert(firstPassResponse.status === 200, "Step32 failed: strict recommend did not return 200.");
      assert(secondPassResponse.status === 200, "Step32 failed: second strict recommend did not return 200.");
      assert(firstPassResponse.body.ok === true, "Step32 failed: recommend response ok flag is false.");
      assert(
        firstPassResponse.body.signingMode === "released_signer",
        "Step32 failed: signingMode is not released_signer."
      );

      const runSummary = firstPassResponse.body.enclaveRunSummary as Record<string, unknown> | undefined;
      const sourceGate = runSummary?.sourceVerificationGate as Record<string, unknown> | undefined;
      const keyRelease = runSummary?.keyRelease as Record<string, unknown> | undefined;
      assert(Boolean(sourceGate), "Step32 failed: missing enclaveRunSummary.sourceVerificationGate.");
      assert(sourceGate?.policyApplied === true, "Step32 failed: source verification gate should be policy-applied.");
      assert(sourceGate?.verified === true, "Step32 failed: source verification gate should be verified.");
      assert(
        sourceGate?.source === mockSourceVerification.source,
        "Step32 failed: source verification gate source mismatch."
      );
      assert(keyRelease?.releasedSignerUsed === true, "Step32 failed: released signer should still be used.");

      const arb = firstPassResponse.body.arb as ArbBundle;
      const provenance = firstPassResponse.body.sourceProvenance as SourceProvenanceReceipt;
      const verifyReleased = verifyArb({
        arb,
        sourceProvenance: provenance,
        devSigningKey: RELEASED_SIGNING_KEY,
        now: FIXED_VERIFY_NOW,
      });
      assert(
        verifyReleased.ok,
        `Step32 failed: ARB does not verify with released signing key (${verifyReleased.errors.join(" | ")})`
      );

      const deterministic = canonicalJson(firstPassResponse.body.arb) === canonicalJson(secondPassResponse.body.arb);
      assert(deterministic, "Step32 failed: strict source-gated recommend output is not deterministic.");

      const artifact = {
        schemaVersion: "step32-source-gated-recommend-v1",
        missingSourceRun: {
          rejected: missingSourceRejected,
          status: missingSourceResponse.status,
          error: missingSourceError || null,
        },
        passRun: {
          signingMode: firstPassResponse.body.signingMode,
          sourceVerificationGate: sourceGate,
          keyRelease,
          verifyReleased,
        },
        deterministic,
        doneCondition:
          "Strict POST /api/recommend now fails closed without source verification runtime and only signs when source verification passes under the configured gate policy.",
      };

      await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
      await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

      console.log(`Saved Step 32 artifact: ${ARTIFACT_PATH}`);
      console.log(`Missing source runtime rejected: ${missingSourceRejected}`);
      console.log(`Verified source gate: ${sourceGate?.verified === true}`);
      console.log(`Deterministic ARB output: ${deterministic}`);
      console.log("Step 32 source-gated recommend test: PASS");
    } finally {
      passServer.close();
    }
  } finally {
    missingServer.close();
    restoreEnv(envSnapshot);
  }
}

main().catch((error) => {
  console.error("Step 32 source-gated recommend test failed.", error);
  process.exitCode = 1;
});
