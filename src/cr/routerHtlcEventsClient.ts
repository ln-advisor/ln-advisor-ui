import https from "node:https";
import WebSocket from "ws";
import type {
  ConditionalRecallRouterConfig,
  ForwardingHistoryEventLike,
  HtlcEventLike,
  HtlcStreamHandle,
  RouterHtlcEventsStreamOptions,
} from "./types";

const MAX_FORWARDING_HISTORY_EVENTS = 50_000;
const DEFAULT_PAGE_SIZE = 1000;

const normalizeRestBaseUrl = (restHost: string): URL => {
  const trimmed = String(restHost || "").trim();
  if (!trimmed) {
    throw new Error("REST host is required.");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed);
  }
  return new URL(`https://${trimmed}`);
};

const readNumberString = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const postJson = async (
  routerConfig: ConditionalRecallRouterConfig,
  pathName: string,
  body: unknown
): Promise<unknown> => {
  const baseUrl = normalizeRestBaseUrl(routerConfig.restHost);
  const payload = JSON.stringify(body ?? {});

  return await new Promise<unknown>((resolve, reject) => {
    const request = https.request(
      {
        protocol: baseUrl.protocol,
        hostname: baseUrl.hostname,
        port: baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80),
        path: pathName,
        method: "POST",
        rejectUnauthorized: !routerConfig.allowSelfSigned,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "Grpc-Metadata-Macaroon": routerConfig.macaroonHex,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8").trim();
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`LND REST request failed (${response.statusCode}): ${text || "empty response"}`));
            return;
          }
          if (!text) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("LND REST endpoint returned invalid JSON."));
          }
        });
      }
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
};

export const fetchForwardingHistory = async (
  routerConfig: ConditionalRecallRouterConfig,
  lookbackDays: number,
  onProgress?: (processed: number) => void
): Promise<ForwardingHistoryEventLike[]> => {
  const events: ForwardingHistoryEventLike[] = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const clampedDays = Math.max(1, Math.min(lookbackDays || 14, 90));
  const startSeconds = nowSeconds - clampedDays * 24 * 60 * 60;
  let indexOffset = 0;

  while (events.length < MAX_FORWARDING_HISTORY_EVENTS) {
    const response = (await postJson(routerConfig, "/v1/switch", {
      start_time: String(startSeconds),
      end_time: String(nowSeconds),
      index_offset: indexOffset,
      num_max_events: DEFAULT_PAGE_SIZE,
      peer_alias_lookup: false,
    })) as Record<string, unknown>;

    const page = Array.isArray(response.forwarding_events)
      ? (response.forwarding_events as ForwardingHistoryEventLike[])
      : [];

    if (page.length === 0) {
      break;
    }

    events.push(...page);
    if (onProgress) {
      onProgress(events.length);
    }

    if (page.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    const nextOffset = Number.parseInt(readNumberString(response.last_offset_index), 10);
    if (!Number.isFinite(nextOffset) || nextOffset <= indexOffset) {
      break;
    }
    indexOffset = nextOffset;
  }

  return events.slice(0, MAX_FORWARDING_HISTORY_EVENTS);
};

const unwrapHtlcEvent = (value: unknown): HtlcEventLike | null => {
  if (!value || typeof value !== "object") return null;
  const typed = value as HtlcEventLike;
  if (typed.result && typeof typed.result === "object") {
    return typed.result as HtlcEventLike;
  }
  return typed;
};

export const openRouterHtlcEventsStream = async (
  options: RouterHtlcEventsStreamOptions
): Promise<HtlcStreamHandle> => {
  const baseUrl = normalizeRestBaseUrl(options.routerConfig.restHost);
  const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  const streamUrl = `${protocol}//${baseUrl.host}/v2/router/htlcevents?method=GET`;

  return await new Promise<HtlcStreamHandle>((resolve, reject) => {
    let opened = false;
    let settled = false;
    const socket = new WebSocket(streamUrl, {
      rejectUnauthorized: !options.routerConfig.allowSelfSigned,
      headers: {
        "Grpc-Metadata-Macaroon": options.routerConfig.macaroonHex,
      },
    });

    const fail = (error: Error): void => {
      if (settled) {
        options.onError(error);
        return;
      }
      settled = true;
      reject(error);
    };

    socket.once("open", () => {
      opened = true;
      try {
        socket.send(JSON.stringify({}));
      } catch {
        // The stream also works without a body; keep the session alive.
      }
      settled = true;
      resolve({
        waitForOpen: async () => undefined,
        close: () => {
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
          }
        },
      });
    });

    socket.on("message", (payload) => {
      try {
        const parsed = JSON.parse(payload.toString("utf8"));
        const event = unwrapHtlcEvent(parsed);
        if (event) {
          options.onEvent(event);
        }
      } catch (error) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on("error", (error) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (!opened) {
        fail(normalized);
        return;
      }
      options.onError(normalized);
    });

    socket.on("unexpected-response", (_request, response) => {
      fail(new Error(`HTLC stream upgrade failed (${response.statusCode || 0}).`));
    });

    socket.on("close", () => {
      if (!opened && !settled) {
        fail(new Error("HTLC stream closed before opening."));
      }
    });
  });
};

export const testRouterStreamConnectivity = async (
  routerConfig: ConditionalRecallRouterConfig
): Promise<void> => {
  const handle = await openRouterHtlcEventsStream({
    routerConfig,
    onEvent: () => undefined,
    onError: () => undefined,
  });
  try {
    await handle.waitForOpen();
  } finally {
    handle.close();
  }
};
