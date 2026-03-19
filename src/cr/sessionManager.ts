import { randomUUID } from "node:crypto";
import { HtlcTrafficAnalyzer } from "./htlcTrafficAnalyzer";
import {
  fetchForwardingHistory,
  testRouterStreamConnectivity,
} from "./routerHtlcEventsClient";
import { conditionalRecallServerDebugLog } from "./serverDebug";
import type {
  ConditionalRecallAnalyzerDependencies,
  ConditionalRecallConfig,
  ConditionalRecallConfigTestResponse,
  ConditionalRecallResult,
  ConditionalRecallSessionManager,
  ConditionalRecallStatus,
} from "./types";

interface ConditionalRecallSessionRecord {
  analyzer: HtlcTrafficAnalyzer | null;
  status: ConditionalRecallStatus;
  result: ConditionalRecallResult | null;
}

export const createConditionalRecallSessionManager = (
  dependencies: Partial<ConditionalRecallAnalyzerDependencies> = {}
): ConditionalRecallSessionManager => {
  const sessions = new Map<string, ConditionalRecallSessionRecord>();
  const fetchHistory = dependencies.fetchForwardingHistory || fetchForwardingHistory;
  const testStreamConnectivity = async (routerConfig: ConditionalRecallConfig["routerConfig"]): Promise<void> => {
    if (dependencies.openRouterHtlcEventsStream) {
      const handle = await dependencies.openRouterHtlcEventsStream({
        routerConfig,
        onEvent: () => undefined,
        onError: () => undefined,
      });
      handle.close();
      return;
    }
    await testRouterStreamConnectivity(routerConfig);
  };

  return {
    async testConfig(routerConfig): Promise<ConditionalRecallConfigTestResponse> {
      conditionalRecallServerDebugLog("config test start", {
        restHost: routerConfig.restHost,
        allowSelfSigned: routerConfig.allowSelfSigned,
      });
      await fetchHistory(routerConfig, 1);
      await testStreamConnectivity(routerConfig);
      conditionalRecallServerDebugLog("config test success", {
        restHost: routerConfig.restHost,
      });
      return {
        ok: true,
        restHost: routerConfig.restHost,
        allowSelfSigned: routerConfig.allowSelfSigned,
        forwardingHistoryReachable: true,
        htlcStreamReachable: true,
      };
    },

    async startSession(config): Promise<{ ok: true; sessionId: string; status: ConditionalRecallStatus }> {
      if (!config.routerConfig?.restHost?.trim()) {
        throw new Error("Conditional Recall requires a REST host.");
      }
      if (!config.routerConfig?.macaroonHex?.trim()) {
        throw new Error("Conditional Recall requires a macaroon hex value.");
      }
      if (!Array.isArray(config.channelHints) || config.channelHints.length === 0) {
        throw new Error("Conditional Recall requires channelHints from the current node session.");
      }

      const safeConfig: ConditionalRecallConfig = {
        ...config,
        lookbackDays: Math.max(1, Math.min(Number(config.lookbackDays || 14), 30)),
        liveWindowSeconds: Math.max(5, Math.min(Number(config.liveWindowSeconds || 300), 3600)),
        channelHints: config.channelHints
          .filter((hint) => hint && String(hint.channelId || "").trim().length > 0)
          .map((hint) => ({
            channelId: String(hint.channelId).trim(),
            channelRef: String(hint.channelRef || "").trim() || "unmapped_channel_0000",
            currentFeePpm:
              hint.currentFeePpm === null || hint.currentFeePpm === undefined
                ? null
                : Number(hint.currentFeePpm),
          })),
      };
      if (safeConfig.channelHints.length === 0) {
        throw new Error("Conditional Recall requires at least one valid channel hint.");
      }

      const sessionId = randomUUID();
      const analyzer = new HtlcTrafficAnalyzer(safeConfig, dependencies);
      const initialStatus = analyzer.getStatus(sessionId);
      conditionalRecallServerDebugLog("session created", {
        sessionId,
        restHost: safeConfig.routerConfig.restHost,
        lookbackDays: safeConfig.lookbackDays,
        liveWindowSeconds: safeConfig.liveWindowSeconds,
        channelHintCount: safeConfig.channelHints.length,
      });
      sessions.set(sessionId, {
        analyzer,
        status: initialStatus,
        result: null,
      });

      void analyzer
        .start()
        .then((result) => {
          const record = sessions.get(sessionId);
          if (!record) return;
          record.result = result;
          record.status = analyzer.getStatus(sessionId);
          record.analyzer = null;
          conditionalRecallServerDebugLog("session completed", {
            sessionId,
            aggregateChannels: result.aggregate.channels.length,
            suggestionCount: result.suggestions.length,
          });
        })
        .catch(async (error) => {
          const record = sessions.get(sessionId);
          if (!record) return;

          if (record.status.state === "canceled") {
            record.status = analyzer.getStatus(sessionId);
            record.analyzer = null;
            return;
          }

          await analyzer.fail(error instanceof Error ? error.message : String(error));
          record.status = analyzer.getStatus(sessionId);
          record.analyzer = null;
          conditionalRecallServerDebugLog("session failed", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return {
        ok: true,
        sessionId,
        status: analyzer.getStatus(sessionId),
      };
    },

    getStatus(sessionId): ConditionalRecallStatus | null {
      const record = sessions.get(sessionId);
      if (!record) return null;
      if (record.analyzer) {
        record.status = record.analyzer.getStatus(sessionId);
      }
      conditionalRecallServerDebugLog("status requested", {
        sessionId,
        state: record.status.state,
      });
      return record.status;
    },

    getResult(sessionId): ConditionalRecallResult | null {
      const record = sessions.get(sessionId);
      if (!record) return null;
      conditionalRecallServerDebugLog("result requested", {
        sessionId,
        available: Boolean(record.result),
      });
      return record.result;
    },

    async cancelSession(sessionId): Promise<ConditionalRecallStatus | null> {
      const record = sessions.get(sessionId);
      if (!record) return null;
      conditionalRecallServerDebugLog("cancel requested", {
        sessionId,
        state: record.status.state,
      });
      if (record.analyzer) {
        await record.analyzer.cancel();
        record.status = record.analyzer.getStatus(sessionId);
        record.analyzer = null;
      }
      return record.status;
    },
  };
};
