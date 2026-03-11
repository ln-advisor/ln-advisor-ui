import type { FrontendTelemetryEnvelope } from "../connectors/types";

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

const API_BASE = (import.meta as any)?.env?.VITE_API_BASE_URL || "http://127.0.0.1:8787";

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
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
