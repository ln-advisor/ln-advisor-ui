import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArbBundle } from "../src/arb/buildArb";
import type { SourceProvenanceReceipt } from "../src/arb/provenance";
import { verifyArb } from "../src/arb/verifyArb";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { createApiServer } from "../src/api/server";

const ARTIFACT_PATH = path.resolve(
  process.cwd(),
  "artifacts",
  "step30.api-released-signer-enforcement.json"
);
const PORT = 8791;
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";
const RELEASED_KEY_ID = "arb-signer-api-step30-v1";
const RELEASED_SIGNING_KEY = "step30-released-signing-key-material";
const KEY_PROVIDER_ID = "api-step30-signing-provider-v1";
const DECOY_DEV_KEY = "step30-decoy-dev-key";

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

async function main(): Promise<void> {
  const telemetry = snapshotToFrontendTelemetry(getMockLightningSnapshot());
  const envSnapshot = captureEnv();
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;

    process.env.API_REQUIRE_RELEASED_SIGNER = "true";
    delete process.env.API_RELEASED_SIGNER_KEY_ID;
    delete process.env.API_RELEASED_SIGNER_KEYRING_JSON;

    const missingConfigResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      issuedAt: FIXED_ISSUED_AT,
    });

    const missingConfigError =
      typeof missingConfigResponse.body.error === "string" ? missingConfigResponse.body.error : "";
    const missingConfigRejected =
      missingConfigResponse.status >= 500 &&
      missingConfigError.includes("Missing required environment variable: API_RELEASED_SIGNER_KEY_ID");
    assert(
      missingConfigRejected,
      "Step30 failed: API should fail closed when released-signer mode is enabled without key config."
    );

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

    const requestPayload = {
      telemetry,
      privacyMode: "feature_only",
      issuedAt: FIXED_ISSUED_AT,
    };

    const firstPassResponse = await postJson(`${baseUrl}/api/recommend`, requestPayload);
    const secondPassResponse = await postJson(`${baseUrl}/api/recommend`, requestPayload);

    assert(firstPassResponse.status === 200, "Step30 failed: released-signer recommend request did not return 200.");
    assert(
      secondPassResponse.status === 200,
      "Step30 failed: second released-signer recommend request did not return 200."
    );

    assert(firstPassResponse.body.ok === true, "Step30 failed: recommend response ok flag is false.");
    assert(
      firstPassResponse.body.signingMode === "released_signer",
      "Step30 failed: response signingMode is not released_signer."
    );

    const runSummary = firstPassResponse.body.enclaveRunSummary as Record<string, unknown> | undefined;
    const keyRelease = runSummary?.keyRelease as Record<string, unknown> | undefined;
    assert(Boolean(keyRelease), "Step30 failed: missing enclaveRunSummary.keyRelease.");
    assert(keyRelease?.releasedSignerRequired === true, "Step30 failed: releasedSignerRequired should be true.");
    assert(keyRelease?.releasedSignerUsed === true, "Step30 failed: releasedSignerUsed should be true.");
    assert(keyRelease?.keySource === KEY_PROVIDER_ID, "Step30 failed: key source mismatch.");

    const arb = firstPassResponse.body.arb as ArbBundle;
    const provenance = firstPassResponse.body.sourceProvenance as SourceProvenanceReceipt;
    const verifyReleased = verifyArb({
      arb,
      sourceProvenance: provenance,
      devSigningKey: RELEASED_SIGNING_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(verifyReleased.ok, `Step30 failed: ARB does not verify with released signing key (${verifyReleased.errors.join(" | ")})`);

    const verifyDecoy = verifyArb({
      arb,
      sourceProvenance: provenance,
      devSigningKey: DECOY_DEV_KEY,
      now: FIXED_VERIFY_NOW,
    });
    assert(!verifyDecoy.ok, "Step30 failed: ARB should not verify with decoy dev key.");

    const deterministic = canonicalJson(firstPassResponse.body.arb) === canonicalJson(secondPassResponse.body.arb);
    assert(deterministic, "Step30 failed: API released-signer ARB output is not deterministic for fixed inputs.");

    const artifact = {
      schemaVersion: "step30-api-released-signer-enforcement-v1",
      missingConfigRun: {
        rejected: missingConfigRejected,
        status: missingConfigResponse.status,
        error: missingConfigError || null,
      },
      passRun: {
        signingMode: firstPassResponse.body.signingMode,
        keyRelease,
        verifyReleased,
        verifyDecoy,
      },
      deterministic,
      doneCondition:
        "API /api/recommend can enforce released-signer-only mode: missing signer config is rejected and successful bundles are signed via key-release provider, not direct dev key fallback.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 30 artifact: ${ARTIFACT_PATH}`);
    console.log(`Missing config rejected: ${missingConfigRejected}`);
    console.log(`Released signer used: ${keyRelease?.releasedSignerUsed === true}`);
    console.log(`Deterministic ARB output: ${deterministic}`);
    console.log("Step 30 API released-signer enforcement test: PASS");
  } finally {
    restoreEnv(envSnapshot);
    server.close();
  }
}

main().catch((error) => {
  console.error("Step 30 API released-signer enforcement test failed.", error);
  process.exitCode = 1;
});
