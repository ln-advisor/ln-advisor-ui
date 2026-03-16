import type { AttestationVerificationGatePolicy } from "../arb/attestationVerificationGate";
import {
  PHALA_CLOUD_API_BASE_URL,
  PHALA_DEFAULT_API_VERSION,
  PhalaCloudApiClient,
  verifyPhalaAttestationBySource,
  type PhalaAttestationVerificationSource,
  type VerifyPhalaAttestationBySourceResult,
} from "../tee/phala";

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

const parseBooleanEnv = (value: string | undefined): boolean =>
  value !== undefined && TRUTHY_ENV_VALUES.has(value.trim().toLowerCase());

const readRequiredEnv = (name: string): string => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return raw.trim();
};

const readOptionalEnv = (name: string): string | undefined => {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : undefined;
};

const resolveSourceFromEnv = (): PhalaAttestationVerificationSource => {
  const requested = readOptionalEnv("PHALA_ATTESTATION_SOURCE");
  if (!requested || requested === "cloud_cvm_attestation") return "cloud_cvm_attestation";
  if (requested === "app_http_attestation") return "app_http_attestation";
  throw new Error(
    `Unsupported PHALA_ATTESTATION_SOURCE value: ${requested}. Use cloud_cvm_attestation or app_http_attestation.`
  );
};

export interface ApiSourceVerificationRuntime {
  schemaVersion: "api-source-verification-runtime-v1";
  source: PhalaAttestationVerificationSource;
  gatePolicy: AttestationVerificationGatePolicy;
  resolve: () => Promise<VerifyPhalaAttestationBySourceResult>;
}

export const createEnvSourceVerificationRuntime = (): ApiSourceVerificationRuntime => {
  const source = resolveSourceFromEnv();
  const apiKey = readRequiredEnv("PHALA_API_KEY");
  const apiBaseUrl = readOptionalEnv("PHALA_CLOUD_API_BASE_URL") || PHALA_CLOUD_API_BASE_URL;
  const apiVersion = readOptionalEnv("PHALA_API_VERSION") || PHALA_DEFAULT_API_VERSION;
  const expectedReportDataHex = readOptionalEnv("PHALA_EXPECTED_REPORT_DATA_HEX");
  const cvmId = readOptionalEnv("PHALA_CVM_ID");
  const appBaseUrl = readOptionalEnv("PHALA_APP_BASE_URL");

  if (source === "cloud_cvm_attestation" && !cvmId) {
    throw new Error("Missing required environment variable: PHALA_CVM_ID");
  }
  if (source === "app_http_attestation" && !appBaseUrl) {
    throw new Error("Missing required environment variable: PHALA_APP_BASE_URL");
  }

  const gatePolicy: AttestationVerificationGatePolicy = {
    schemaVersion: "attestation-verification-gate-policy-v1",
    requireSourceVerification: true,
    requireVerifiedQuote: true,
    allowedSources: [source],
    requireAppComposeBindingForAppSource:
      !parseBooleanEnv(process.env.API_ALLOW_APP_SOURCE_WITHOUT_COMPOSE_BINDING),
    requireReportDataMatchWhenExpected:
      !parseBooleanEnv(process.env.API_ALLOW_SOURCE_WITHOUT_EXPECTED_REPORT_DATA_MATCH),
  };

  return {
    schemaVersion: "api-source-verification-runtime-v1",
    source,
    gatePolicy,
    resolve: async () => {
      const cloudClient = new PhalaCloudApiClient({
        apiKey,
        apiBaseUrl,
        apiVersion: apiVersion as typeof PHALA_DEFAULT_API_VERSION,
      });

      return verifyPhalaAttestationBySource({
        source,
        cloudClient,
        cvmId,
        appBaseUrl,
        expectedReportDataHex,
      });
    },
  };
};
