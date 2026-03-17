import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PHALA_CLOUD_API_BASE_URL,
  PHALA_DEFAULT_API_VERSION,
  PHALA_DOC_LINKS,
  PhalaCloudApiClient,
  verifyPhalaAttestationBySource,
  type PhalaAttestationVerificationSource,
} from "../src/tee/phala";
import { loadEnvFiles } from "./_lib/loadEnvFiles";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-attestation-source-live.json");

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

const resolveSource = (input: {
  source: string | null;
  appBaseUrl: string | null;
  cvmId: string | null;
}): PhalaAttestationVerificationSource => {
  if (input.source === "app_http_attestation" || input.source === "cloud_cvm_attestation") {
    return input.source;
  }
  if (input.appBaseUrl && !input.cvmId) {
    return "app_http_attestation";
  }
  return "cloud_cvm_attestation";
};

async function main(): Promise<void> {
  const envLoad = loadEnvFiles({
    files: [".env", ".env.test"],
  });

  const apiKey = readRequiredEnv("PHALA_API_KEY");
  const apiBaseUrl = readOptionalEnv("PHALA_CLOUD_API_BASE_URL") || PHALA_CLOUD_API_BASE_URL;
  const apiVersion = readOptionalEnv("PHALA_API_VERSION") || PHALA_DEFAULT_API_VERSION;
  const appBaseUrl = readOptionalEnv("PHALA_APP_BASE_URL");
  const cvmId = readOptionalEnv("PHALA_CVM_ID");
  const expectedReportDataHex = readOptionalEnv("PHALA_EXPECTED_REPORT_DATA_HEX");
  const requestedSource = readOptionalEnv("PHALA_ATTESTATION_SOURCE");
  const source = resolveSource({
    source: requestedSource,
    appBaseUrl,
    cvmId,
  });

  if (source === "cloud_cvm_attestation" && !cvmId) {
    throw new Error("PHALA_CVM_ID is required when PHALA_ATTESTATION_SOURCE=cloud_cvm_attestation.");
  }
  if (source === "app_http_attestation" && !appBaseUrl) {
    throw new Error("PHALA_APP_BASE_URL is required when PHALA_ATTESTATION_SOURCE=app_http_attestation.");
  }

  const cloudClient = new PhalaCloudApiClient({
    apiKey,
    apiBaseUrl,
    apiVersion: apiVersion as typeof PHALA_DEFAULT_API_VERSION,
  });

  const currentUser = await cloudClient.getCurrentUserV20260121();
  const sourceResult = await verifyPhalaAttestationBySource({
    source,
    cloudClient,
    cvmId: cvmId || undefined,
    appBaseUrl: appBaseUrl || undefined,
    expectedReportDataHex: expectedReportDataHex || undefined,
  });

  const cloudConnectivityOk = Boolean(currentUser.data.userId);
  const overallOk = cloudConnectivityOk && sourceResult.ok;

  const artifact = {
    schemaVersion: "phala-attestation-source-live-v1",
    config: {
      apiBaseUrl,
      apiVersion,
      loadedEnvFiles: envLoad.loadedFiles,
      source,
      requestedSource,
      cvmId,
      appBaseUrl,
      expectedReportDataProvided: Boolean(expectedReportDataHex),
    },
    checks: {
      cloudConnectivityOk,
      sourceVerificationOk: sourceResult.ok,
      overallOk,
    },
    currentUser: currentUser.data,
    sourceVerification: sourceResult,
    docs: {
      cloudApiOverview: PHALA_DOC_LINKS.cloudApiOverview,
      attestationOverview: PHALA_DOC_LINKS.attestationOverview,
      verifyApplication: PHALA_DOC_LINKS.attestationVerifyApp,
      verifyPlatform: PHALA_DOC_LINKS.attestationVerifyPlatform,
    },
    doneCondition:
      "Live attestation verification succeeds for the selected source (cloud_cvm_attestation or app_http_attestation) with explicit source-specific requirements.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Phala Attestation Source Live artifact: ${ARTIFACT_PATH}`);
  console.log(`Selected source: ${source}`);
  console.log(`Cloud connectivity: ${cloudConnectivityOk ? "PASS" : "FAIL"}`);
  console.log(`Source verification: ${sourceResult.ok ? "PASS" : "FAIL"}`);
  console.log(`Phala Attestation Source Live test: ${overallOk ? "PASS" : "FAIL"}`);

  if (!overallOk) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Phala Attestation Source Live test failed.", error);
  process.exitCode = 1;
});

