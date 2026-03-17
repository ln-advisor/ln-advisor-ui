import { DEFAULT_PHALA_MINIMAL_APP_URL } from "../config/phala";

const PHALA_MINIMAL_APP_URL = String(
  import.meta.env.VITE_PHALA_MINIMAL_APP_URL || DEFAULT_PHALA_MINIMAL_APP_URL
)
  .trim()
  .replace(/\/+$/, "");
const PHALA_UI_FLAG = String(import.meta.env.VITE_ENABLE_PHALA_VERIFIED_UI || "").trim().toLowerCase();
const PHALA_DEBUG_LOGS_FLAG = String(import.meta.env.VITE_ENABLE_PHALA_DEBUG_LOGS || "").trim().toLowerCase();
const PHALA_DEV_PROXY_BASE = "/__phala";

const isTruthy = (value: string): boolean => ["1", "true", "yes", "on"].includes(value);

export interface PhalaUiConfig {
  enabled: boolean;
  available: boolean;
  appUrl: string;
  reason: string | null;
}

export interface PhalaVerifiedRunResult {
  health: unknown | null;
  recommend: any;
  info: any;
  attestation: any;
  verify: any;
}

const isPhalaDebugLogsEnabled = (): boolean => isTruthy(PHALA_DEBUG_LOGS_FLAG);

const appendDebugQuery = (path: string): string => {
  if (!isPhalaDebugLogsEnabled()) return path;
  return path.includes("?") ? `${path}&debug=true` : `${path}?debug=true`;
};

const ensureBaseUrl = (): string => {
  if (!PHALA_MINIMAL_APP_URL) {
    throw new Error("Missing verified service configuration.");
  }
  return import.meta.env.DEV ? PHALA_DEV_PROXY_BASE : PHALA_MINIMAL_APP_URL;
};

const parseJsonResponse = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`Verified request failed with empty response (${response.status}).`);
    }
    throw new Error(`Verified service returned an empty response (${response.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Verified service returned invalid JSON (${response.status}).`);
  }
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${ensureBaseUrl()}${path}`, {
    headers: { accept: "application/json" },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Verified request failed for ${path}`);
  }
  return payload as T;
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${ensureBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Verified request failed for ${path}`);
  }
  return payload as T;
};

export const getPhalaUiConfig = (): PhalaUiConfig => {
  const enabled = isTruthy(PHALA_UI_FLAG);
  const available = enabled && PHALA_MINIMAL_APP_URL.length > 0;

  if (!enabled) {
    return {
      enabled: false,
      available: false,
      appUrl: PHALA_MINIMAL_APP_URL,
      reason: null,
    };
  }

  if (!PHALA_MINIMAL_APP_URL) {
    return {
      enabled: true,
      available: false,
      appUrl: "",
      reason: "Verified service is not configured.",
    };
  }

  return {
    enabled: true,
    available: true,
    appUrl: PHALA_MINIMAL_APP_URL,
    reason: null,
  };
};

export const getPhalaHealth = async <T = unknown>(): Promise<T> => getJson<T>("/health");

export const runPhalaVerifiedRecommendation = async (
  telemetry: unknown
): Promise<PhalaVerifiedRunResult> => {
  const recommend = await postJson<any>(appendDebugQuery("/api/recommend?full=true"), { telemetry });
  const healthPromise = getPhalaHealth().catch(() => null);
  const info = await getJson<any>("/info?full=true");
  const attestation = await getJson<any>("/attestation?full=true");
  const verify = await postJson<any>("/api/verify", {
    transformedSnapshot: recommend?.transformedSnapshot,
    recommendationSet: recommend?.recommendationSet,
    arb: recommend?.arb,
    sourceReceipt: recommend?.sourceReceipt,
    liveAppInfo: info,
    liveAppAttestation: attestation,
  });

  const result = {
    health: await healthPromise,
    recommend,
    info,
    attestation,
    verify,
  };

  if (isPhalaDebugLogsEnabled()) {
    console.groupCollapsed("[LN Advisor] Verified Runtime Debug");
    console.info("Submitted telemetry", telemetry);
    console.info("Transformed snapshot", result.recommend?.transformedSnapshot);
    console.info("Recommendation set", result.recommend?.recommendationSet);
    console.info("Debug trace", result.recommend?.debugTrace || null);
    console.info("Health", result.health);
    console.info("Runtime info", result.info);
    console.info("Runtime attestation", result.attestation);
    console.info("Verify", result.verify);
    console.groupEnd();
  }

  return result;
};
