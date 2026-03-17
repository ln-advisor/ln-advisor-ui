import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApiServer, type ApiServerOptions } from "../src/api/server";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import type { VerifyPhalaAttestationBySourceResult } from "../src/tee/phala";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "trust-aware-verify.json");
const PORT = 8794;
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";
const RELEASED_KEY_ID = "arb-signer-trust-aware-verify-v1";
const RELEASED_SIGNING_KEY = "trust-aware-verify-released-signing-key-material";
const DECOY_DEV_KEY = "trust-aware-verify-decoy-dev-key";
const KEY_PROVIDER_ID = "trust-aware-verify-v1";

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
    quoteHex: "ef".repeat(256),
    reportData: "11".repeat(32),
    composeHashFromInfo: null,
    composeHashFromEventLog: null,
  },
  verifier: {
    docs: {
      verifyYourApplication: "https://docs.phala.com/phala-cloud/attestation/verify-your-application",
      verifyThePlatform: "https://docs.phala.com/phala-cloud/attestation/verify-the-platform",
      attestationApiReference: "https://docs.phala.com/phala-cloud/phala-cloud-api/attestations",
    },
    note: "trust-aware-verify mock source verification",
  },
};

const mismatchedSourceVerification: VerifyPhalaAttestationBySourceResult = {
  ...mockSourceVerification,
  source: "app_http_attestation",
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
  const requestPayload = {
    telemetry,
    privacyMode: "feature_only",
    issuedAt: FIXED_ISSUED_AT,
  };

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

  const server = createApiServer({
    sourceVerificationRuntime,
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const recommendResponse = await postJson(`${baseUrl}/api/recommend`, requestPayload);
    assert(recommendResponse.status === 200, "Trust Aware Verify failed: recommend request did not return 200.");

    const arb = recommendResponse.body.arb;
    const sourceProvenance = recommendResponse.body.sourceProvenance;

    const devVerifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arb,
      sourceProvenance,
      devSigningKey: RELEASED_SIGNING_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(devVerifyResponse.status === 200, "Trust Aware Verify failed: dev verify request did not return 200.");
    assert(devVerifyResponse.body.ok === true, "Trust Aware Verify failed: base verify should pass.");

    const strictVerifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arb,
      sourceProvenance,
      sourceVerification: mockSourceVerification,
      trustPolicyProfile: "strict",
      devSigningKey: RELEASED_SIGNING_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(strictVerifyResponse.status === 200, "Trust Aware Verify failed: strict verify request did not return 200.");
    assert(strictVerifyResponse.body.ok === true, "Trust Aware Verify failed: strict verify should pass.");

    const strictChecks = strictVerifyResponse.body.checks as Record<string, unknown> | undefined;
    const strictArbCheck = strictChecks?.arb as Record<string, unknown> | undefined;
    const strictAttestationCheck =
      strictChecks?.attestationPolicy as Record<string, unknown> | undefined;
    const strictSourceCheck = strictChecks?.sourceBinding as Record<string, unknown> | undefined;
    assert(strictArbCheck?.ok === true, "Trust Aware Verify failed: arb check should pass.");
    assert(strictAttestationCheck?.applied === true, "Trust Aware Verify failed: attestation policy should be applied.");
    assert(strictSourceCheck?.applied === true, "Trust Aware Verify failed: source binding should be applied.");

    const missingSourceVerifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arb,
      sourceProvenance,
      trustPolicyProfile: "strict",
      devSigningKey: RELEASED_SIGNING_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(missingSourceVerifyResponse.status === 200, "Trust Aware Verify failed: missing-source verify request did not return 200.");
    assert(missingSourceVerifyResponse.body.ok === false, "Trust Aware Verify failed: strict verify should fail without source verification.");
    const missingChecks = missingSourceVerifyResponse.body.checks as Record<string, unknown> | undefined;
    assert(
      (missingChecks?.arb as Record<string, unknown> | undefined)?.ok === true,
      "Trust Aware Verify failed: arb check should remain valid even when trust policy fails."
    );

    const mismatchedSourceVerifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arb,
      sourceProvenance,
      sourceVerification: mismatchedSourceVerification,
      trustPolicyProfile: "strict",
      devSigningKey: RELEASED_SIGNING_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(
      mismatchedSourceVerifyResponse.status === 200,
      "Trust Aware Verify failed: mismatched-source verify request did not return 200."
    );
    assert(
      mismatchedSourceVerifyResponse.body.ok === false,
      "Trust Aware Verify failed: strict verify should fail when source binding mismatches."
    );

    const artifact = {
      schemaVersion: "trust-aware-verify-v1",
      passRun: {
        devVerify: devVerifyResponse.body,
        strictVerify: strictVerifyResponse.body,
      },
      failRun: {
        missingSourceVerification: missingSourceVerifyResponse.body,
        mismatchedSourceVerification: mismatchedSourceVerifyResponse.body,
      },
      doneCondition:
        "POST /api/verify now distinguishes structural ARB validity from trust-policy validity and rejects missing or mismatched source verification under strict policy.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Trust Aware Verify artifact: ${ARTIFACT_PATH}`);
    console.log(`Strict verify pass: ${strictVerifyResponse.body.ok === true}`);
    console.log(`Missing source rejected: ${missingSourceVerifyResponse.body.ok === false}`);
    console.log(`Mismatched source rejected: ${mismatchedSourceVerifyResponse.body.ok === false}`);
    console.log("Trust Aware Verify test: PASS");
  } finally {
    server.close();
    restoreEnv(envSnapshot);
  }
}

main().catch((error) => {
  console.error("Trust Aware Verify test failed.", error);
  process.exitCode = 1;
});


