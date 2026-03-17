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

declare global {
  interface Window {
    __LN_ADVISOR_PHALA_DEBUG__?: {
      enabled: boolean;
      entries: Array<{ label: string; payload?: unknown; timestamp: string }>;
      last?: { label: string; payload?: unknown; timestamp: string };
    };
  }
}

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
const pushBrowserDebugEntry = (label: string, payload?: unknown): void => {
  if (typeof window === "undefined") return;
  const state = window.__LN_ADVISOR_PHALA_DEBUG__ || {
    enabled: true,
    entries: [],
  };
  const entry = {
    label,
    payload,
    timestamp: new Date().toISOString(),
  };
  state.enabled = true;
  state.entries.push(entry);
  state.last = entry;
  window.__LN_ADVISOR_PHALA_DEBUG__ = state;
};

const debugLog = (label: string, payload?: unknown): void => {
  if (!isPhalaDebugLogsEnabled()) return;
  pushBrowserDebugEntry(label, payload);
  if (payload === undefined) {
    console.warn(`[LN Advisor][Verified Runtime] ${label}`);
    return;
  }
  console.warn(`[LN Advisor][Verified Runtime] ${label}`, payload);
};

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
  const recommendPath = appendDebugQuery("/api/recommend?full=true");
  const healthPath = "/health";
  const infoPath = "/info?full=true";
  const attestationPath = "/attestation?full=true";
  const verifyPath = "/api/verify";

  debugLog("start", {
    baseUrl: ensureBaseUrl(),
    recommendPath,
    healthPath,
    infoPath,
    attestationPath,
    verifyPath,
    telemetry,
  });

  try {
    const recommend = await postJson<any>(recommendPath, { telemetry });
    debugLog("recommend response", {
      ok: recommend?.ok,
      mode: recommend?.mode,
      modelVersion: recommend?.modelVersion,
      summary: recommend?.recommendationSet?.summary || null,
      debugTrace: recommend?.debugTrace || null,
    });

    const healthPromise = getPhalaHealth()
      .then((health) => {
        debugLog("health response", health);
        return health;
      })
      .catch((error) => {
        debugLog("health response failed", error instanceof Error ? error.message : String(error));
        return null;
      });

    const info = await getJson<any>(infoPath);
    debugLog("info response", info);

    const attestation = await getJson<any>(attestationPath);
    debugLog("attestation response", attestation);

    const verify = await postJson<any>(verifyPath, {
      transformedSnapshot: recommend?.transformedSnapshot,
      recommendationSet: recommend?.recommendationSet,
      arb: recommend?.arb,
      sourceReceipt: recommend?.sourceReceipt,
      liveAppInfo: info,
      liveAppAttestation: attestation,
    });
    debugLog("verify response", verify);

    const result = {
      health: await healthPromise,
      recommend,
      info,
      attestation,
      verify,
    };

    debugLog("complete", {
      verifyOk: result.verify?.ok,
      quoteVerified: result.verify?.cloudVerification?.quoteVerified || false,
      errors: result.verify?.errors || [],
    });

    return result;
  } catch (error) {
    debugLog("failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    throw error;
  }
};
