import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PHALA_CLOUD_API_BASE_URL,
  PHALA_DEFAULT_API_VERSION,
  PHALA_DOC_LINKS,
  PhalaCloudApiClient,
  verifyPhalaApplicationAttestation,
} from "../src/tee/phala";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-live-smoke.json");

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

const readRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const readOptionalEnv = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
};

async function main(): Promise<void> {
  const apiKey = readRequiredEnv("PHALA_API_KEY");
  const apiBaseUrl = readOptionalEnv("PHALA_CLOUD_API_BASE_URL") || PHALA_CLOUD_API_BASE_URL;
  const apiVersion = readOptionalEnv("PHALA_API_VERSION") || PHALA_DEFAULT_API_VERSION;
  const appBaseUrl = readOptionalEnv("PHALA_APP_BASE_URL");
  const cvmId = readOptionalEnv("PHALA_CVM_ID");

  const client = new PhalaCloudApiClient({
    apiKey,
    apiBaseUrl,
    apiVersion: apiVersion as typeof PHALA_DEFAULT_API_VERSION,
  });

  const currentUser = await client.getCurrentUserV20260121();
  const cvmInfo = cvmId ? await client.getCvmInfoV20260121(cvmId) : null;

  const attestationResult = appBaseUrl
    ? await verifyPhalaApplicationAttestation({
        appBaseUrl,
        cloudClient: client,
      })
    : null;

  const cloudConnectivityOk = Boolean(currentUser.data.userId);
  const appAttestationOk = attestationResult ? attestationResult.ok : null;
  const overallOk = cloudConnectivityOk && (attestationResult ? attestationResult.ok : true);

  const artifact = {
    schemaVersion: "phala-live-smoke-v1",
    runMode: {
      readOnly: true,
      appAttestationEnabled: Boolean(appBaseUrl),
      cvmInfoEnabled: Boolean(cvmId),
      skippedOperations: [
        "POST /cvms/provision",
        "POST /cvms",
        "PATCH /cvms/{cvmId}/envs",
        "PATCH /cvms/{cvmId}/docker-compose",
      ],
    },
    config: {
      apiBaseUrl,
      apiVersion,
      appBaseUrl,
      cvmId,
    },
    checks: {
      cloudConnectivityOk,
      appAttestationOk,
      overallOk,
    },
    currentUser: currentUser.data,
    cvmInfo: cvmInfo?.data || null,
    appAttestation: attestationResult,
    docs: {
      cloudApiOverview: PHALA_DOC_LINKS.cloudApiOverview,
      apiVersioning: PHALA_DOC_LINKS.cloudSdkApiVersioning,
      attestationOverview: PHALA_DOC_LINKS.attestationOverview,
      verifyApplication: PHALA_DOC_LINKS.attestationVerifyApp,
    },
    doneCondition:
      "Read-only live Phala smoke test passes: Cloud API auth works and, when PHALA_APP_BASE_URL is set, app attestation verification also passes.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Phala Live Smoke artifact: ${ARTIFACT_PATH}`);
  console.log(`Cloud connectivity: ${cloudConnectivityOk ? "PASS" : "FAIL"}`);
  if (attestationResult) {
    console.log(`App attestation verification: ${attestationResult.ok ? "PASS" : "FAIL"}`);
  } else {
    console.log("App attestation verification: SKIPPED (set PHALA_APP_BASE_URL to enable)");
  }
  console.log(`Phala Live Smoke test: ${overallOk ? "PASS" : "FAIL"}`);

  if (!overallOk) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Phala Live Smoke test failed.", error);
  process.exitCode = 1;
});

