import { createHash } from "node:crypto";
import { PhalaCloudApiClient } from "./client";
import { PHALA_DOC_LINKS } from "./constants";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeHex = (value: string): string => value.trim().toLowerCase().replace(/^0x/, "");

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const toStringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const parseJsonObject = (value: unknown, fieldName: string): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      throw new Error(`Invalid JSON string in ${fieldName}.`);
    }
  }
  throw new Error(`${fieldName} must be a JSON object or stringified JSON object.`);
};

export interface PhalaAppInfoResponse {
  tcb_info?: {
    app_compose?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PhalaAppAttestationResponse {
  quote: string;
  event_log?: unknown;
  report_data?: string;
  [key: string]: unknown;
}

export interface PhalaRtmrEvent {
  imr?: number | string;
  index?: number | string;
  event?: string;
  digest?: string;
  value?: string;
  [key: string]: unknown;
}

export interface VerifyPhalaApplicationAttestationOptions {
  appBaseUrl: string;
  cloudClient: PhalaCloudApiClient;
  expectedReportDataHex?: string;
  attestationPath?: string;
  infoPath?: string;
  fetchImpl?: typeof fetch;
}

export interface VerifyPhalaApplicationAttestationResult {
  schemaVersion: "phala-app-attestation-verification-v1";
  ok: boolean;
  checks: {
    quoteVerifiedByPhalaApi: boolean;
    composeHashMatchesRtmr3Event: boolean;
    reportDataMatchesExpected: boolean | null;
  };
  attestation: {
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

const parseEventLog = (eventLogValue: unknown): PhalaRtmrEvent[] => {
  if (Array.isArray(eventLogValue)) {
    return eventLogValue.filter((entry) => isRecord(entry)) as PhalaRtmrEvent[];
  }
  if (typeof eventLogValue === "string" && eventLogValue.trim().length > 0) {
    try {
      const parsed = JSON.parse(eventLogValue);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry) => isRecord(entry)) as PhalaRtmrEvent[];
      }
    } catch {
      throw new Error("attestation.event_log is not valid JSON.");
    }
  }
  return [];
};

const extractComposeHashFromEventLog = (events: readonly PhalaRtmrEvent[]): string | null => {
  for (const event of events) {
    const eventName = typeof event.event === "string" ? event.event.toLowerCase() : "";
    if (eventName === "compose-hash" || eventName === "app-compose-hash") {
      const digest = toStringOrNull(event.digest) || toStringOrNull(event.value);
      if (digest) {
        return normalizeHex(digest);
      }
    }
  }
  return null;
};

const fetchJson = async (
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string
): Promise<Record<string, unknown>> => {
  const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${text}`);
  }

  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new Error("response is not a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const verifyPhalaApplicationAttestation = async (
  options: VerifyPhalaApplicationAttestationOptions
): Promise<VerifyPhalaApplicationAttestationResult> => {
  const fetchImpl = options.fetchImpl || fetch;
  const attestationPath = options.attestationPath || "/attestation?full=true";
  const infoPath = options.infoPath || "/info?full=true";
  const appBaseUrl = options.appBaseUrl.replace(/\/+$/, "");

  const [attestationRaw, infoRaw] = await Promise.all([
    fetchJson(fetchImpl, appBaseUrl, attestationPath),
    fetchJson(fetchImpl, appBaseUrl, infoPath),
  ]);

  const attestation = parseJsonObject(attestationRaw, "attestation");
  const info = parseJsonObject(infoRaw, "info") as PhalaAppInfoResponse;

  const quoteHex = toStringOrNull(attestation.quote);
  if (!quoteHex) {
    throw new Error("Application attestation endpoint did not return a quote.");
  }

  const tcbInfo = isRecord(info.tcb_info) ? info.tcb_info : {};
  const appCompose = toStringOrNull(tcbInfo.app_compose);
  const directComposeHash = toStringOrNull(tcbInfo.compose_hash) || toStringOrNull(tcbInfo.composeHash);
  const composeHashFromInfo = appCompose ? sha256Hex(appCompose) : directComposeHash ? normalizeHex(directComposeHash) : null;

  const eventLog = parseEventLog(attestation.event_log);
  const composeHashFromEventLog = extractComposeHashFromEventLog(eventLog);

  const verifyResponse = await options.cloudClient.verifyAttestationQuote(quoteHex);
  const quoteVerifiedByPhalaApi = verifyResponse.data.quoteVerified;

  const composeHashMatchesRtmr3Event =
    composeHashFromInfo !== null &&
    composeHashFromEventLog !== null &&
    normalizeHex(composeHashFromInfo) === normalizeHex(composeHashFromEventLog);

  const expectedReportDataHex = options.expectedReportDataHex ? normalizeHex(options.expectedReportDataHex) : null;
  const reportData = toStringOrNull(attestation.report_data);
  const normalizedReportData = reportData ? normalizeHex(reportData) : null;
  const reportDataMatchesExpected =
    expectedReportDataHex === null ? null : normalizedReportData === normalizeHex(expectedReportDataHex);

  const ok =
    quoteVerifiedByPhalaApi &&
    composeHashMatchesRtmr3Event &&
    (reportDataMatchesExpected === null || reportDataMatchesExpected === true);

  return {
    schemaVersion: "phala-app-attestation-verification-v1",
    ok,
    checks: {
      quoteVerifiedByPhalaApi,
      composeHashMatchesRtmr3Event,
      reportDataMatchesExpected,
    },
    attestation: {
      quoteHex,
      reportData: normalizedReportData,
      composeHashFromInfo,
      composeHashFromEventLog,
    },
    verifier: {
      docs: {
        verifyYourApplication: PHALA_DOC_LINKS.attestationVerifyApp,
        verifyThePlatform: PHALA_DOC_LINKS.attestationVerifyPlatform,
        attestationApiReference: PHALA_DOC_LINKS.attestationApiReference,
      },
      note:
        "This verifier is intended to run outside the CVM boundary. It verifies quote validity via Phala API and compares app compose hash against RTMR3 event-log evidence.",
    },
  };
};
