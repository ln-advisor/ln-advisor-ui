import type { FrontendTelemetryEnvelope } from "../connectors/types";
import type {
  ConditionalRecallChannelHint,
  ConditionalRecallConfigTestResponse,
  ConditionalRecallResult,
  ConditionalRecallSessionStartResponse,
  ConditionalRecallStatus,
} from "../cr/types";

export interface BuildFrontendTelemetryEnvelopeInput {
  collectedAt?: string;
  namespace?: string;
  nodeInfo: unknown | null;
  channels: unknown[];
  forwardingHistory: unknown[];
  routingFailures?: unknown[];
  feePolicies?: unknown[];
  peers?: unknown[];
  graphSnapshot?: {
    fetchedAt?: string;
    includeUnannounced?: boolean;
    includeAuthProof?: boolean;
    nodes?: unknown[];
    edges?: unknown[];
    [key: string]: unknown;
  } | null;
  missionControl?: {
    pairs?: unknown[];
    [key: string]: unknown;
  } | null;
  nodeMetrics?: {
    betweennessCentrality?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
}

export interface RecommendApiRequest {
  telemetry: FrontendTelemetryEnvelope;
  privacyMode?: "full_internal" | "feature_only" | "banded";
  issuedAt?: string;
}

const resolveApiBase = (): string => {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!configured) return "";

  // In local development, prefer the Vite proxy so the browser does not need
  // to reach the WSL API port directly.
  if (
    import.meta.env.DEV &&
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(configured)
  ) {
    return "";
  }

  return configured;
};

const API_BASE = resolveApiBase();

const parseJsonResponse = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`API request failed with empty response (${response.status}).`);
    }
    throw new Error(`API returned an empty response (${response.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`API returned invalid JSON (${response.status}).`);
  }
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error((payload && payload.error) || `API request failed for ${path}`);
  }
  return payload as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error((payload && payload.error) || `API request failed for ${path}`);
  }
  return payload as T;
};

export const buildFrontendTelemetryEnvelope = (
  input: BuildFrontendTelemetryEnvelopeInput
): FrontendTelemetryEnvelope => ({
  schemaVersion: "frontend-telemetry-envelope-v1",
  collectedAt: input.collectedAt || new Date().toISOString(),
  namespace: input.namespace || "tapvolt",
  nodeInfo: input.nodeInfo,
  channels: Array.isArray(input.channels) ? input.channels : [],
  forwardingHistory: Array.isArray(input.forwardingHistory) ? input.forwardingHistory : [],
  routingFailures: Array.isArray(input.routingFailures) ? input.routingFailures : [],
  feePolicies: Array.isArray(input.feePolicies) ? input.feePolicies : [],
  peers: Array.isArray(input.peers) ? input.peers : [],
  graphSnapshot: input.graphSnapshot || null,
  missionControl: input.missionControl || { pairs: [] },
  nodeMetrics: input.nodeMetrics || { betweennessCentrality: {} },
});

export const postSnapshot = async <T = unknown>(telemetry: FrontendTelemetryEnvelope): Promise<T> =>
  postJson<T>("/api/snapshot", { telemetry });

export const postRecommend = async <T = unknown>(request: RecommendApiRequest): Promise<T> =>
  postJson<T>("/api/recommend", {
    telemetry: request.telemetry,
    privacyMode: request.privacyMode || "feature_only",
    ...(request.issuedAt ? { issuedAt: request.issuedAt } : {}),
  });

export const postVerify = async <T = unknown>(arb: unknown, sourceProvenance?: unknown): Promise<T> =>
  postJson<T>("/api/verify", {
    arb,
    ...(sourceProvenance ? { sourceProvenance } : {}),
  });

export const postAnalyzeGemini = async <T = unknown>(telemetry: unknown, recommendation: unknown): Promise<T> =>
  postJson<T>("/api/analyze-gemini", { telemetry, recommendation });

// ─────────────────────────────────────────────────────────────────────────────
// PROPS-specific typed API calls
// Each function sends only the data relevant to its analysis type.
// The payload must be derived from the PROPS pipeline (applyPrivacyPolicy),
// never raw telemetry, so no private node identifiers reach the server.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Channel Opening Recommendations
 * Route: POST /api/recommend/channel-openings
 *
 * Sends PROPS feature_only node state built from full-graph data:
 *  - Peer aggregates (channel counts, balance ratios, mission control reliability)
 *  - Potential peer list with betweenness centrality scores
 *  - Node-level totals (forward count, revenue, failed forwards)
 *
 * Does NOT include: raw pubkeys, actual balances, per-channel fee policies,
 * or forwarding history detail — only anonymised references and ratios.
 */
export interface ChannelOpeningRecommendRequest {
  /** PROPS feature_only transformed node state (output of applyPrivacyPolicy) */
  propsPayload: unknown;
  privacyMode?: "feature_only" | "banded";
  issuedAt?: string;
}

export const postChannelOpeningRecommendations = async <T = unknown>(
  request: ChannelOpeningRecommendRequest
): Promise<T> =>
  postJson<T>("/api/recommend/channel-openings", {
    propsPayload: request.propsPayload,
    privacyMode: request.privacyMode || "feature_only",
    ...(request.issuedAt ? { issuedAt: request.issuedAt } : {}),
  });

/**
 * Fee Suggestion for a single channel
 * Route: POST /api/recommend/fee-suggestions
 *
 * Sends PROPS feature_only node state scoped to a single channel:
 *  - Channel liquidity ratio (local/remote balance as ratios, not raw sats)
 *  - Forwarding counts and revenue for the channel (from PROPS normalisation)
 *  - Current fee policies (outbound ppm, inbound ppm) via PROPS channel data
 *  - Peer network fee context (avg/weighted avg ppm from the peer's other channels)
 *
 * Does NOT include: full graph, other channels, unrelated peers, raw pubkeys,
 * or actual satoshi amounts — only anonymised references and ratios.
 */
export interface FeeSuggestionRequest {
  /** PROPS feature_only transformed node state scoped to one channel (output of applyPrivacyPolicy) */
  propsPayload: unknown;
  /** Additional peer-network fee context not available in the normalised snapshot */
  peerFeeContext?: {
    networkInAvgPpm: number | null;
    networkOutAvgPpm: number | null;
  };
  privacyMode?: "feature_only" | "banded";
  issuedAt?: string;
}

export const postFeeSuggestion = async <T = unknown>(
  request: FeeSuggestionRequest
): Promise<T> =>
  postJson<T>("/api/recommend/fee-suggestions", {
    propsPayload: request.propsPayload,
    ...(request.peerFeeContext ? { peerFeeContext: request.peerFeeContext } : {}),
    privacyMode: request.privacyMode || "feature_only",
    ...(request.issuedAt ? { issuedAt: request.issuedAt } : {}),
  });

export interface ConditionalRecallRouterConfigInput {
  restHost: string;
  macaroonHex: string;
  allowSelfSigned: boolean;
}

export interface ConditionalRecallSessionRequest {
  routerConfig: ConditionalRecallRouterConfigInput;
  lookbackDays?: number;
  liveWindowSeconds?: number;
  channelHints: ConditionalRecallChannelHint[];
}

export const postConditionalRecallConfigTest = async (
  routerConfig: ConditionalRecallRouterConfigInput
): Promise<ConditionalRecallConfigTestResponse> =>
  postJson<ConditionalRecallConfigTestResponse>("/api/cr/config/test", {
    routerConfig,
  });

export const postConditionalRecallSessionStart = async (
  request: ConditionalRecallSessionRequest
): Promise<ConditionalRecallSessionStartResponse> =>
  postJson<ConditionalRecallSessionStartResponse>("/api/cr/sessions", {
    routerConfig: request.routerConfig,
    lookbackDays: request.lookbackDays ?? 14,
    liveWindowSeconds: request.liveWindowSeconds ?? 300,
    channelHints: request.channelHints,
  });

export const getConditionalRecallSessionStatus = async (
  sessionId: string
): Promise<{ ok: true; status: ConditionalRecallStatus }> =>
  getJson<{ ok: true; status: ConditionalRecallStatus }>(`/api/cr/sessions/${encodeURIComponent(sessionId)}`);

export const getConditionalRecallSessionResult = async (
  sessionId: string
): Promise<{ ok: true; sessionId: string; result: ConditionalRecallResult }> =>
  getJson<{ ok: true; sessionId: string; result: ConditionalRecallResult }>(
    `/api/cr/sessions/${encodeURIComponent(sessionId)}/result`
  );

export const postConditionalRecallSessionCancel = async (
  sessionId: string
): Promise<{ ok: true; status: ConditionalRecallStatus }> =>
  postJson<{ ok: true; status: ConditionalRecallStatus }>(
    `/api/cr/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {}
  );
