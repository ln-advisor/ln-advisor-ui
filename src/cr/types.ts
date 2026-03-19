export type ConditionalRecallSessionState =
  | "idle"
  | "testing_config"
  | "starting"
  | "collecting_history"
  | "streaming_live"
  | "analyzing"
  | "completed"
  | "failed"
  | "canceled";

export interface ConditionalRecallRouterConfig {
  restHost: string;
  macaroonHex: string;
  allowSelfSigned: boolean;
}

export interface ConditionalRecallChannelHint {
  channelId: string;
  channelRef: string;
  currentFeePpm: number | null;
}

export interface ConditionalRecallConfig {
  routerConfig: ConditionalRecallRouterConfig;
  lookbackDays: number;
  liveWindowSeconds: number;
  channelHints: ConditionalRecallChannelHint[];
}

export interface ChannelTrafficStats {
  attempts: number;
  settles: number;
  forwardFails: number;
  linkFails: number;
  totalAmtInSat: number;
  totalAmtOutSat: number;
  failedAmtSat: number;
  observedFeeSat: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface ConditionalRecallAggregateChannel {
  channelRef: string;
  attempts: number;
  settles: number;
  forwardFails: number;
  linkFails: number;
  totalAmtInSat: number;
  totalAmtOutSat: number;
  failedAmtSat: number;
  observedFeeSat: number;
  currentFeePpm: number | null;
  successRate: number;
  failureRate: number;
  failurePressure: number;
  volumePressure: number;
  frictionScore: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface ConditionalRecallAggregateV1 {
  schemaVersion: "conditional-recall-aggregate-v1";
  collectedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  lookbackDays: number;
  liveWindowSeconds: number;
  channels: ConditionalRecallAggregateChannel[];
}

export interface FeeAdjustmentSuggestionV1 {
  channelRef: string;
  action: "raise" | "lower";
  frictionScore: number;
  confidence: number;
  currentFeePpm: number | null;
  suggestedFeePpm: number;
  reasons: string[];
  windowStart: string | null;
  windowEnd: string | null;
}

export interface ConditionalRecallSessionProgress {
  historyEventsProcessed: number;
  liveEventsProcessed: number;
  channelsTracked: number;
}

export interface ConditionalRecallStatus {
  sessionId: string;
  state: ConditionalRecallSessionState;
  startedAt: string;
  endsAt: string | null;
  progress: ConditionalRecallSessionProgress;
  error: string | null;
  configSummary: {
    restHost: string;
    allowSelfSigned: boolean;
    lookbackDays: number;
    liveWindowSeconds: number;
    channelHintCount: number;
  };
}

export interface ConditionalRecallResult {
  aggregate: ConditionalRecallAggregateV1;
  suggestions: FeeAdjustmentSuggestionV1[];
  collectionSummary: {
    startedAt: string;
    completedAt: string;
    windowStart: string | null;
    windowEnd: string | null;
    historyEventsProcessed: number;
    liveEventsProcessed: number;
    channelsTracked: number;
  };
}

export interface ConditionalRecallSessionStartResponse {
  ok: true;
  sessionId: string;
  status: ConditionalRecallStatus;
}

export interface ConditionalRecallConfigTestResponse {
  ok: true;
  restHost: string;
  allowSelfSigned: boolean;
  forwardingHistoryReachable: boolean;
  htlcStreamReachable: boolean;
}

export interface ForwardingHistoryEventLike {
  chanIdIn?: string | number | null;
  chan_id_in?: string | number | null;
  chanIdOut?: string | number | null;
  chan_id_out?: string | number | null;
  amtIn?: string | number | null;
  amt_in?: string | number | null;
  amtOut?: string | number | null;
  amt_out?: string | number | null;
  fee?: string | number | null;
  fee_sat?: string | number | null;
  timestamp?: string | number | null;
  [key: string]: unknown;
}

export interface HtlcInfoLike {
  incoming_amt_msat?: string | number | null;
  outgoing_amt_msat?: string | number | null;
  [key: string]: unknown;
}

export interface HtlcEventLike {
  incoming_channel_id?: string | number | null;
  outgoing_channel_id?: string | number | null;
  timestamp_ns?: string | number | null;
  event_type?: string | null;
  forward_event?: {
    info?: HtlcInfoLike | null;
    [key: string]: unknown;
  } | null;
  forward_fail_event?: Record<string, unknown> | null;
  settle_event?: Record<string, unknown> | null;
  link_fail_event?: {
    info?: HtlcInfoLike | null;
    [key: string]: unknown;
  } | null;
  result?: HtlcEventLike | null;
  [key: string]: unknown;
}

export interface HtlcStreamHandle {
  waitForOpen(): Promise<void>;
  close(): void;
}

export interface RouterHtlcEventsStreamOptions {
  routerConfig: ConditionalRecallRouterConfig;
  onEvent: (event: HtlcEventLike) => void;
  onError: (error: Error) => void;
}

export interface ConditionalRecallAnalyzerDependencies {
  fetchForwardingHistory: (
    config: ConditionalRecallRouterConfig,
    lookbackDays: number,
    onProgress?: (processed: number) => void
  ) => Promise<ForwardingHistoryEventLike[]>;
  openRouterHtlcEventsStream: (
    options: RouterHtlcEventsStreamOptions
  ) => Promise<HtlcStreamHandle>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  now: () => number;
}

export interface ConditionalRecallSessionManager {
  testConfig(
    routerConfig: ConditionalRecallRouterConfig
  ): Promise<ConditionalRecallConfigTestResponse>;
  startSession(config: ConditionalRecallConfig): Promise<ConditionalRecallSessionStartResponse>;
  getStatus(sessionId: string): ConditionalRecallStatus | null;
  getResult(sessionId: string): ConditionalRecallResult | null;
  cancelSession(sessionId: string): Promise<ConditionalRecallStatus | null>;
}
