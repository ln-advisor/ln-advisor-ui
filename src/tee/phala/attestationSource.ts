import { PHALA_DOC_LINKS } from "./constants";
import { PhalaCloudApiClient } from "./client";
import { verifyPhalaApplicationAttestation } from "./verifier";

export type PhalaAttestationVerificationSource = "cloud_cvm_attestation" | "app_http_attestation";

export interface VerifyPhalaAttestationBySourceOptions {
  source: PhalaAttestationVerificationSource;
  cloudClient: PhalaCloudApiClient;
  cvmId?: string;
  appBaseUrl?: string;
  expectedReportDataHex?: string;
  attestationPath?: string;
  infoPath?: string;
  fetchImpl?: typeof fetch;
}

export interface VerifyPhalaAttestationBySourceResult {
  schemaVersion: "phala-attestation-source-verification-v1";
  source: PhalaAttestationVerificationSource;
  ok: boolean;
  checks: {
    quoteVerifiedByPhalaApi: boolean;
    composeHashMatchesRtmr3Event: boolean | null;
    reportDataMatchesExpected: boolean | null;
  };
  attestation: {
    quoteFormat: string | null;
    quoteHex: string;
    reportData: string | null;
    composeHashFromInfo: string | null;
    composeHashFromEventLog: string | null;
  };
  verifier: {
    docs: {
      verifyYourApplication: string;
      verifyThePlatform: string;
      attestationApiReference: string;
    };
    note: string;
  };
}

const normalizeHex = (value: string): string => value.trim().toLowerCase().replace(/^0x/, "");

const normalizeOptionalHex = (value: string | null | undefined): string | null => {
  if (!value || !value.trim()) return null;
  return normalizeHex(value);
};

const requireNonEmpty = (value: string | undefined, name: string): string => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`Missing required option for attestation source verification: ${name}`);
  }
  return normalized;
};

export const verifyPhalaAttestationBySource = async (
  options: VerifyPhalaAttestationBySourceOptions
): Promise<VerifyPhalaAttestationBySourceResult> => {
  if (options.source === "app_http_attestation") {
    const appBaseUrl = requireNonEmpty(options.appBaseUrl, "appBaseUrl");
    const appResult = await verifyPhalaApplicationAttestation({
      appBaseUrl,
      cloudClient: options.cloudClient,
      expectedReportDataHex: options.expectedReportDataHex,
      attestationPath: options.attestationPath,
      infoPath: options.infoPath,
      fetchImpl: options.fetchImpl,
    });

    return {
      schemaVersion: "phala-attestation-source-verification-v1",
      source: "app_http_attestation",
      ok: appResult.ok,
      checks: appResult.checks,
      attestation: {
        quoteFormat: null,
        quoteHex: appResult.attestation.quoteHex,
        reportData: appResult.attestation.reportData,
        composeHashFromInfo: appResult.attestation.composeHashFromInfo,
        composeHashFromEventLog: appResult.attestation.composeHashFromEventLog,
      },
      verifier: appResult.verifier,
    };
  }

  const cvmId = requireNonEmpty(options.cvmId, "cvmId");
  const cvmAttestation = await options.cloudClient.getCvmAttestation(cvmId);
  const quoteVerify = await options.cloudClient.verifyAttestationQuote(cvmAttestation.data.quote);

  const reportData = normalizeOptionalHex(cvmAttestation.data.reportData);
  const expectedReportData = normalizeOptionalHex(options.expectedReportDataHex);
  const reportDataMatchesExpected =
    expectedReportData === null ? null : reportData === null ? false : reportData === expectedReportData;

  const quoteVerifiedByPhalaApi = quoteVerify.data.quoteVerified;
  const ok = quoteVerifiedByPhalaApi && (reportDataMatchesExpected === null || reportDataMatchesExpected === true);

  return {
    schemaVersion: "phala-attestation-source-verification-v1",
    source: "cloud_cvm_attestation",
    ok,
    checks: {
      quoteVerifiedByPhalaApi,
      composeHashMatchesRtmr3Event: null,
      reportDataMatchesExpected,
    },
    attestation: {
      quoteFormat: cvmAttestation.data.quoteFormat,
      quoteHex: cvmAttestation.data.quote,
      reportData,
      composeHashFromInfo: null,
      composeHashFromEventLog: null,
    },
    verifier: {
      docs: {
        verifyYourApplication: PHALA_DOC_LINKS.attestationVerifyApp,
        verifyThePlatform: PHALA_DOC_LINKS.attestationVerifyPlatform,
        attestationApiReference: PHALA_DOC_LINKS.attestationApiReference,
      },
      note:
        "Cloud CVM source verifies quote validity via Phala attestation API. For compose RTMR linkage, use app_http_attestation source with /info and /attestation endpoints.",
    },
  };
};
