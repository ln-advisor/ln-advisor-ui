import {
  buildFeeAdjustmentSuggestions,
  deriveFrictionMetrics,
} from "./scoreTrafficFriction";
import {
  fetchForwardingHistory as fetchForwardingHistoryDefault,
  openRouterHtlcEventsStream as openRouterHtlcEventsStreamDefault,
} from "./routerHtlcEventsClient";
import type {
  ChannelTrafficStats,
  ConditionalRecallAggregateChannel,
  ConditionalRecallAnalyzerDependencies,
  ConditionalRecallConfig,
  ConditionalRecallResult,
  ConditionalRecallSessionProgress,
  ConditionalRecallSessionState,
  ConditionalRecallStatus,
  ForwardingHistoryEventLike,
  HtlcEventLike,
  HtlcStreamHandle,
} from "./types";

const toInteger = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
};

const msatToSat = (value: unknown): number => Math.max(0, Math.trunc(toInteger(value) / 1000));

const timestampFromNs = (value: unknown): string | null => {
  const raw = toInteger(value);
  if (!raw) return null;
  const millis = Math.trunc(raw / 1_000_000);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return new Date(millis).toISOString();
};

const timestampFromSeconds = (value: unknown): string | null => {
  const raw = toInteger(value);
  if (!raw) return null;
  const millis = raw < 1_000_000_000_000 ? raw * 1000 : raw;
  return new Date(millis).toISOString();
};

const normalizeChannelId = (value: unknown): string => {
  const channelId = String(value ?? "").trim();
  return channelId === "0" ? "" : channelId;
};

const createEmptyStats = (): ChannelTrafficStats => ({
  attempts: 0,
  settles: 0,
  forwardFails: 0,
  linkFails: 0,
  totalAmtInSat: 0,
  totalAmtOutSat: 0,
  failedAmtSat: 0,
  observedFeeSat: 0,
  windowStart: null,
  windowEnd: null,
});

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const mergeWindow = (
  stats: ChannelTrafficStats,
  at: string | null
): void => {
  if (!at) return;
  if (!stats.windowStart || stats.windowStart > at) {
    stats.windowStart = at;
  }
  if (!stats.windowEnd || stats.windowEnd < at) {
    stats.windowEnd = at;
  }
};

const defaultDependencies: ConditionalRecallAnalyzerDependencies = {
  fetchForwardingHistory: fetchForwardingHistoryDefault,
  openRouterHtlcEventsStream: openRouterHtlcEventsStreamDefault,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  now: () => Date.now(),
};

export class HtlcTrafficAnalyzer {
  private readonly config: ConditionalRecallConfig;
  private readonly dependencies: ConditionalRecallAnalyzerDependencies;
  private readonly statsByChannelId = new Map<string, ChannelTrafficStats>();
  private readonly channelHintById = new Map<string, ConditionalRecallConfig["channelHints"][number]>();
  private readonly progress: ConditionalRecallSessionProgress = {
    historyEventsProcessed: 0,
    liveEventsProcessed: 0,
    channelsTracked: 0,
  };
  private state: ConditionalRecallSessionState = "idle";
  private errorMessage: string | null = null;
  private readonly startedAt: string;
  private endsAt: string | null = null;
  private streamHandle: HtlcStreamHandle | null = null;
  private liveWindowHandle: ReturnType<typeof setTimeout> | null = null;
  private liveWindowReject: ((error: Error) => void) | null = null;
  private canceled = false;
  private completedResult: ConditionalRecallResult | null = null;

  constructor(
    config: ConditionalRecallConfig,
    dependencies: Partial<ConditionalRecallAnalyzerDependencies> = {}
  ) {
    this.config = config;
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.startedAt = new Date(this.dependencies.now()).toISOString();
    for (const hint of config.channelHints || []) {
      this.channelHintById.set(String(hint.channelId), hint);
    }
  }

  getStatus(sessionId: string): ConditionalRecallStatus {
    return {
      sessionId,
      state: this.state,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      progress: { ...this.progress },
      error: this.errorMessage,
      configSummary: {
        restHost: this.config.routerConfig.restHost,
        allowSelfSigned: this.config.routerConfig.allowSelfSigned,
        lookbackDays: this.config.lookbackDays,
        liveWindowSeconds: this.config.liveWindowSeconds,
        channelHintCount: this.config.channelHints.length,
      },
    };
  }

  async start(): Promise<ConditionalRecallResult> {
    if (this.completedResult) {
      return this.completedResult;
    }

    this.transition("starting");
    this.transition("collecting_history");

    const history = await this.dependencies.fetchForwardingHistory(
      this.config.routerConfig,
      this.config.lookbackDays,
      (processed) => {
        this.progress.historyEventsProcessed = processed;
      }
    );
    this.ingestForwardingHistoryRows(history);

    if (this.canceled) {
      throw new Error("Conditional Recall session canceled.");
    }

    this.transition("streaming_live");
    this.endsAt = new Date(this.dependencies.now() + this.config.liveWindowSeconds * 1000).toISOString();
    this.streamHandle = await this.dependencies.openRouterHtlcEventsStream({
      routerConfig: this.config.routerConfig,
      onEvent: (event) => {
        if (this.canceled || this.state !== "streaming_live") return;
        if (this.ingestHtlcEvent(event)) {
          this.progress.liveEventsProcessed += 1;
        }
      },
      onError: (error) => {
        if (this.canceled) return;
        this.errorMessage = error.message;
        void this.fail(error.message);
      },
    });
    await this.streamHandle.waitForOpen();

    await new Promise<void>((resolve, reject) => {
      this.liveWindowReject = reject;
      this.liveWindowHandle = this.dependencies.setTimer(() => {
        this.liveWindowReject = null;
        resolve();
      }, Math.max(1, this.config.liveWindowSeconds) * 1000);

      if (this.canceled) {
        reject(new Error("Conditional Recall session canceled."));
      }
    });

    if (this.canceled) {
      throw new Error("Conditional Recall session canceled.");
    }

    this.transition("analyzing");
    const result = this.flushAndAnalyze();
    this.releaseRuntimeResources();
    return result;
  }

  ingestForwardingHistoryRows(events: ForwardingHistoryEventLike[]): number {
    let processed = 0;
    for (const event of Array.isArray(events) ? events : []) {
      if (!event || typeof event !== "object") continue;

      const channelIn = normalizeChannelId(event.chanIdIn ?? event.chan_id_in);
      const channelOut = normalizeChannelId(event.chanIdOut ?? event.chan_id_out);
      const at = timestampFromSeconds(event.timestamp);
      const amtInSat = Math.max(0, toInteger(event.amtIn ?? event.amt_in));
      const amtOutSat = Math.max(0, toInteger(event.amtOut ?? event.amt_out));
      const feeSat = Math.max(0, toInteger(event.fee ?? event.fee_sat));

      if (channelIn) {
        const stats = this.ensureStats(channelIn);
        stats.attempts += 1;
        stats.settles += 1;
        stats.totalAmtInSat += amtInSat;
        mergeWindow(stats, at);
      }

      if (channelOut) {
        const stats = this.ensureStats(channelOut);
        stats.attempts += 1;
        stats.settles += 1;
        stats.totalAmtOutSat += amtOutSat;
        stats.observedFeeSat += feeSat;
        mergeWindow(stats, at);
      }

      processed += 1;
    }

    this.progress.historyEventsProcessed = processed;
    this.progress.channelsTracked = this.statsByChannelId.size;
    return processed;
  }

  ingestHtlcEvent(rawEvent: HtlcEventLike): boolean {
    const event = rawEvent?.result && typeof rawEvent.result === "object" ? rawEvent.result : rawEvent;
    if (!event || typeof event !== "object") {
      return false;
    }

    const eventType = String(event.event_type || "").trim().toUpperCase();
    if (eventType !== "FORWARD") {
      return false;
    }

    const channelIn = normalizeChannelId(event.incoming_channel_id);
    const channelOut = normalizeChannelId(event.outgoing_channel_id);
    const at = timestampFromNs(event.timestamp_ns);
    const forwardInfo = event.forward_event?.info || null;
    const linkFailInfo = event.link_fail_event?.info || null;

    let touched = false;

    if (event.forward_event) {
      if (channelIn) {
        const stats = this.ensureStats(channelIn);
        stats.attempts += 1;
        stats.totalAmtInSat += msatToSat(forwardInfo?.incoming_amt_msat);
        mergeWindow(stats, at);
        touched = true;
      }
      if (channelOut) {
        const stats = this.ensureStats(channelOut);
        stats.attempts += 1;
        stats.totalAmtOutSat += msatToSat(forwardInfo?.outgoing_amt_msat);
        mergeWindow(stats, at);
        touched = true;
      }
    }

    if (event.settle_event) {
      if (channelIn) {
        const stats = this.ensureStats(channelIn);
        stats.settles += 1;
        mergeWindow(stats, at);
        touched = true;
      }
      if (channelOut) {
        const stats = this.ensureStats(channelOut);
        stats.settles += 1;
        mergeWindow(stats, at);
        touched = true;
      }
    }

    if (event.forward_fail_event) {
      if (channelIn) {
        const stats = this.ensureStats(channelIn);
        stats.forwardFails += 1;
        mergeWindow(stats, at);
        touched = true;
      }
      if (channelOut) {
        const stats = this.ensureStats(channelOut);
        stats.forwardFails += 1;
        mergeWindow(stats, at);
        touched = true;
      }
    }

    if (event.link_fail_event) {
      const failedAmtInSat = msatToSat(linkFailInfo?.incoming_amt_msat);
      const failedAmtOutSat = msatToSat(linkFailInfo?.outgoing_amt_msat);
      if (channelIn) {
        const stats = this.ensureStats(channelIn);
        stats.linkFails += 1;
        stats.failedAmtSat += failedAmtInSat;
        mergeWindow(stats, at);
        touched = true;
      }
      if (channelOut) {
        const stats = this.ensureStats(channelOut);
        stats.linkFails += 1;
        stats.failedAmtSat += failedAmtOutSat;
        mergeWindow(stats, at);
        touched = true;
      }
    }

    this.progress.channelsTracked = this.statsByChannelId.size;
    return touched;
  }

  async cancel(reason = "Conditional Recall session canceled."): Promise<void> {
    this.canceled = true;
    if (this.state !== "failed") {
      this.errorMessage = reason;
    }
    this.transition("canceled");
    this.releaseRuntimeResources();
    this.statsByChannelId.clear();
    this.progress.channelsTracked = 0;
  }

  async fail(reason: string): Promise<void> {
    this.errorMessage = reason;
    this.transition("failed");
    this.releaseRuntimeResources();
    this.statsByChannelId.clear();
    this.progress.channelsTracked = 0;
  }

  flushAndAnalyze(): ConditionalRecallResult {
    const aggregateChannels = this.buildAggregateChannels();
    const collectedAt = new Date(this.dependencies.now()).toISOString();
    const aggregate = {
      schemaVersion: "conditional-recall-aggregate-v1" as const,
      collectedAt,
      windowStart:
        aggregateChannels.length > 0
          ? aggregateChannels
              .map((channel) => channel.windowStart)
              .filter(Boolean)
              .sort(compareText)[0] || null
          : null,
      windowEnd:
        aggregateChannels.length > 0
          ? aggregateChannels
              .map((channel) => channel.windowEnd)
              .filter(Boolean)
              .sort(compareText)
              .at(-1) || null
          : null,
      lookbackDays: this.config.lookbackDays,
      liveWindowSeconds: this.config.liveWindowSeconds,
      channels: aggregateChannels,
    };
    const suggestions = buildFeeAdjustmentSuggestions(aggregateChannels);
    const result: ConditionalRecallResult = {
      aggregate,
      suggestions,
      collectionSummary: {
        startedAt: this.startedAt,
        completedAt: collectedAt,
        windowStart: aggregate.windowStart,
        windowEnd: aggregate.windowEnd,
        historyEventsProcessed: this.progress.historyEventsProcessed,
        liveEventsProcessed: this.progress.liveEventsProcessed,
        channelsTracked: aggregateChannels.length,
      },
    };

    this.statsByChannelId.clear();
    this.progress.channelsTracked = 0;
    this.completedResult = result;
    this.transition("completed");
    return result;
  }

  private ensureStats(channelId: string): ChannelTrafficStats {
    const existing = this.statsByChannelId.get(channelId);
    if (existing) {
      return existing;
    }
    const created = createEmptyStats();
    this.statsByChannelId.set(channelId, created);
    this.progress.channelsTracked = this.statsByChannelId.size;
    return created;
  }

  private buildAggregateChannels(): ConditionalRecallAggregateChannel[] {
    const unknownChannelIds = Array.from(this.statsByChannelId.keys())
      .filter((channelId) => !this.channelHintById.has(channelId))
      .sort(compareText);
    const unknownRefById = new Map(
      unknownChannelIds.map((channelId, index) => [
        channelId,
        `unmapped_channel_${String(index + 1).padStart(4, "0")}`,
      ])
    );

    return Array.from(this.statsByChannelId.entries())
      .map(([channelId, stats]) => {
        const hint = this.channelHintById.get(channelId);
        const channelRef = hint?.channelRef || unknownRefById.get(channelId) || "unmapped_channel_0000";
        const base = {
          channelRef,
          attempts: stats.attempts,
          settles: stats.settles,
          forwardFails: stats.forwardFails,
          linkFails: stats.linkFails,
          totalAmtInSat: stats.totalAmtInSat,
          totalAmtOutSat: stats.totalAmtOutSat,
          failedAmtSat: stats.failedAmtSat,
          observedFeeSat: stats.observedFeeSat,
          currentFeePpm: hint?.currentFeePpm ?? null,
          windowStart: stats.windowStart,
          windowEnd: stats.windowEnd,
        };
        return {
          ...base,
          ...deriveFrictionMetrics(base),
        };
      })
      .sort((left, right) => right.frictionScore - left.frictionScore || left.channelRef.localeCompare(right.channelRef));
  }

  private transition(nextState: ConditionalRecallSessionState): void {
    this.state = nextState;
    if (nextState === "completed" || nextState === "canceled" || nextState === "failed") {
      if (!this.endsAt) {
        this.endsAt = new Date(this.dependencies.now()).toISOString();
      }
    }
  }

  private releaseRuntimeResources(): void {
    if (this.liveWindowHandle) {
      this.dependencies.clearTimer(this.liveWindowHandle);
      this.liveWindowHandle = null;
    }
    if (this.liveWindowReject) {
      const reject = this.liveWindowReject;
      this.liveWindowReject = null;
      reject(new Error(this.errorMessage || "Conditional Recall session stopped."));
    }
    if (this.streamHandle) {
      this.streamHandle.close();
      this.streamHandle = null;
    }
  }
}
