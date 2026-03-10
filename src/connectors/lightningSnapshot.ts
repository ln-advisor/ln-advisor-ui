import LNC from "@lightninglabs/lnc-web";
import type {
  GraphSnapshotReference,
  LightningChannel,
  LightningFeePolicy,
  LightningForwardingEvent,
  LightningNodeInfo,
  LightningPeer,
  LightningRoutingFailure,
  LightningSnapshot,
  NumericLike,
} from "./types";

type JsonObject = Record<string, unknown>;

const DEFAULT_NAMESPACE = "tapvolt";
const DEFAULT_FORWARDING_RANGE_DAYS = 30;
const MAX_FORWARDING_EVENTS = 50_000;

const toRecord = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as JsonObject;
};

const readString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const readNumberLike = (value: unknown): NumericLike | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
};

const pick = <T = unknown>(record: JsonObject, ...keys: string[]): T | undefined => {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key] as T;
  }
  return undefined;
};

const normalizeChannelId = (record: JsonObject): string =>
  readString(pick(record, "chanId", "chan_id", "channelId", "channel_id"));

const normalizeNodeInfo = (value: unknown): LightningNodeInfo => {
  const raw = toRecord(value);
  return {
    ...raw,
    identityPubkey: readString(pick(raw, "identityPubkey", "identity_pubkey")),
    alias: readString(pick(raw, "alias")),
    numActiveChannels: readNumberLike(pick(raw, "numActiveChannels", "num_active_channels")),
    numPeers: readNumberLike(pick(raw, "numPeers", "num_peers")),
    blockHeight: readNumberLike(pick(raw, "blockHeight", "block_height")),
    syncedToChain: Boolean(pick(raw, "syncedToChain", "synced_to_chain")),
    syncedToGraph: Boolean(pick(raw, "syncedToGraph", "synced_to_graph")),
    testnet: Boolean(pick(raw, "testnet")),
    chains: Array.isArray(pick(raw, "chains")) ? (pick(raw, "chains") as unknown[]) : undefined,
    uris: Array.isArray(pick(raw, "uris")) ? (pick(raw, "uris") as string[]) : undefined,
  };
};

const normalizeChannel = (value: unknown): LightningChannel => {
  const raw = toRecord(value);
  return {
    ...raw,
    chanId: normalizeChannelId(raw),
    channelPoint: readString(pick(raw, "channelPoint", "channel_point")),
    remotePubkey: readString(pick(raw, "remotePubkey", "remote_pubkey")),
    active: pick(raw, "active") !== undefined ? Boolean(pick(raw, "active")) : undefined,
    capacity: readNumberLike(pick(raw, "capacity")),
    localBalance: readNumberLike(pick(raw, "localBalance", "local_balance")),
    remoteBalance: readNumberLike(pick(raw, "remoteBalance", "remote_balance")),
    totalSatoshisSent: readNumberLike(pick(raw, "totalSatoshisSent", "total_satoshis_sent")),
    totalSatoshisReceived: readNumberLike(pick(raw, "totalSatoshisReceived", "total_satoshis_received")),
    numUpdates: readNumberLike(pick(raw, "numUpdates", "num_updates")),
  };
};

const normalizeForwardingEvent = (value: unknown): LightningForwardingEvent => {
  const raw = toRecord(value);
  return {
    ...raw,
    timestamp: readNumberLike(pick(raw, "timestamp")),
    timestampNs: readNumberLike(pick(raw, "timestampNs", "timestamp_ns")),
    chanIdIn: readString(pick(raw, "chanIdIn", "chan_id_in")),
    chanIdOut: readString(pick(raw, "chanIdOut", "chan_id_out")),
    amtIn: readNumberLike(pick(raw, "amtIn", "amt_in", "amtInSat", "amt_in_sat")),
    amtOut: readNumberLike(pick(raw, "amtOut", "amt_out", "amtOutSat", "amt_out_sat")),
    fee: readNumberLike(pick(raw, "fee", "feeSat", "fee_sat")),
  };
};

const normalizePeer = (value: unknown): LightningPeer => {
  const raw = toRecord(value);
  return {
    ...raw,
    pubKey: readString(pick(raw, "pubKey", "pub_key", "pubkey")),
    address: readString(pick(raw, "address")),
    bytesSent: readNumberLike(pick(raw, "bytesSent", "bytes_sent")),
    bytesRecv: readNumberLike(pick(raw, "bytesRecv", "bytes_recv")),
    satSent: readNumberLike(pick(raw, "satSent", "sat_sent")),
    satRecv: readNumberLike(pick(raw, "satRecv", "sat_recv")),
    inbound: pick(raw, "inbound") !== undefined ? Boolean(pick(raw, "inbound")) : undefined,
    pingTime: readNumberLike(pick(raw, "pingTime", "ping_time")),
  };
};

const normalizeFeePolicyRecord = (
  channelId: string,
  directionPubKey: string,
  rawPolicy: JsonObject
): LightningFeePolicy => ({
  ...rawPolicy,
  channelId,
  directionPubKey,
  feeRatePpm: readNumberLike(pick(rawPolicy, "feeRateMilliMsat", "fee_rate_milli_msat")),
  feeBaseMsat: readNumberLike(pick(rawPolicy, "feeBaseMsat", "fee_base_msat")),
  timeLockDelta: readNumberLike(pick(rawPolicy, "timeLockDelta", "time_lock_delta")),
  minHtlcMsat: readNumberLike(pick(rawPolicy, "minHtlc", "min_htlc")),
  maxHtlcMsat: readNumberLike(pick(rawPolicy, "maxHtlcMsat", "max_htlc_msat")),
  disabled: pick(rawPolicy, "disabled") !== undefined ? Boolean(pick(rawPolicy, "disabled")) : undefined,
});

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareNumberLike = (a: NumericLike | undefined, b: NumericLike | undefined): number => {
  const aNum = typeof a === "number" ? a : Number.parseFloat(String(a ?? "0"));
  const bNum = typeof b === "number" ? b : Number.parseFloat(String(b ?? "0"));
  if (aNum < bNum) return -1;
  if (aNum > bNum) return 1;
  return 0;
};

const buildGraphSnapshotRef = (graphResponse: JsonObject | null): GraphSnapshotReference | null => {
  if (!graphResponse) return null;
  const nodes = Array.isArray(pick(graphResponse, "nodes")) ? (pick(graphResponse, "nodes") as unknown[]) : [];
  const edges = Array.isArray(pick(graphResponse, "edges")) ? (pick(graphResponse, "edges") as unknown[]) : [];
  return {
    source: "describeGraph",
    fetchedAt: new Date().toISOString(),
    includeUnannounced: false,
    includeAuthProof: false,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
};

const extractFeePolicies = (graphResponse: JsonObject | null): LightningFeePolicy[] => {
  if (!graphResponse) return [];
  const edges = Array.isArray(pick(graphResponse, "edges")) ? (pick(graphResponse, "edges") as unknown[]) : [];
  const feePolicies: LightningFeePolicy[] = [];
  for (const edge of edges) {
    const edgeRecord = toRecord(edge);
    const channelId = readString(pick(edgeRecord, "channel_id", "channelId"));
    if (!channelId) continue;

    const node1Pub = readString(pick(edgeRecord, "node1_pub", "node1Pub"));
    const node2Pub = readString(pick(edgeRecord, "node2_pub", "node2Pub"));
    const node1Policy = toRecord(pick(edgeRecord, "node1_policy", "node1Policy"));
    const node2Policy = toRecord(pick(edgeRecord, "node2_policy", "node2Policy"));

    if (Object.keys(node1Policy).length > 0) {
      feePolicies.push(normalizeFeePolicyRecord(channelId, node1Pub, node1Policy));
    }
    if (Object.keys(node2Policy).length > 0) {
      feePolicies.push(normalizeFeePolicyRecord(channelId, node2Pub, node2Policy));
    }
  }

  return feePolicies.sort((a, b) => {
    const byChan = compareText(a.channelId, b.channelId);
    if (byChan !== 0) return byChan;
    return compareText(a.directionPubKey, b.directionPubKey);
  });
};

const getForwardingWindow = (): { start: string; end: string } => {
  const endSeconds = Math.floor(Date.now() / 1000);
  const daysRaw = process.env.LNC_FORWARDING_RANGE_DAYS ?? String(DEFAULT_FORWARDING_RANGE_DAYS);
  const daysParsed = Number.parseInt(daysRaw, 10);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? daysParsed : DEFAULT_FORWARDING_RANGE_DAYS;
  const startSeconds = endSeconds - days * 24 * 60 * 60;
  return { start: String(startSeconds), end: String(endSeconds) };
};

const fetchRoutingFailures = async (): Promise<LightningRoutingFailure[]> => {
  // TODO(step-1): Replace placeholder with a concrete routing-failure RPC once selected.
  return [];
};

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const createLncClient = async (): Promise<unknown> => {
  const namespace = process.env.LNC_NAMESPACE?.trim() || DEFAULT_NAMESPACE;
  const serverHost = process.env.LNC_SERVER_HOST?.trim();
  const pairingPhrase = requireEnv("LNC_PAIRING_PHRASE");
  const password = requireEnv("LNC_PASSWORD");

  const lnc = new LNC({
    namespace,
    ...(serverHost ? { serverHost } : {}),
  }) as any;
  lnc.credentials.pairingPhrase = pairingPhrase;
  lnc.credentials.password = password;
  await lnc.connect();
  return lnc;
};

export async function getLightningSnapshot(): Promise<LightningSnapshot> {
  const namespace = process.env.LNC_NAMESPACE?.trim() || DEFAULT_NAMESPACE;
  const lnc = (await createLncClient()) as any;
  const lightning = lnc?.lnd?.lightning;
  if (!lightning) {
    throw new Error("LNC client is connected but lightning RPC service is unavailable.");
  }

  const [{ infoResult, channelsResult, peersResult, forwardingResult, graphResult }, routingFailures] =
    await Promise.all([
      (async () => {
        const [infoResult, channelsResult, peersResult, forwardingResult, graphResult] = await Promise.all([
          typeof lightning.getInfo === "function" ? lightning.getInfo() : null,
          typeof lightning.listChannels === "function" ? lightning.listChannels() : null,
          typeof lightning.listPeers === "function" ? lightning.listPeers() : null,
          typeof lightning.forwardingHistory === "function"
            ? lightning.forwardingHistory({
                ...getForwardingWindow(),
                index_offset: 0,
                num_max_events: MAX_FORWARDING_EVENTS,
                peer_alias_lookup: false,
              })
            : null,
          typeof lightning.describeGraph === "function"
            ? lightning.describeGraph({
                include_unannounced: false,
                include_auth_proof: false,
              })
            : null,
        ]);
        return { infoResult, channelsResult, peersResult, forwardingResult, graphResult };
      })(),
      fetchRoutingFailures(),
    ]);

  const nodeInfo = infoResult ? normalizeNodeInfo(infoResult) : null;
  const channelsRaw = Array.isArray(pick(toRecord(channelsResult), "channels"))
    ? (pick(toRecord(channelsResult), "channels") as unknown[])
    : [];
  const channels = channelsRaw
    .map(normalizeChannel)
    .sort((a, b) => compareText(a.chanId || "", b.chanId || ""));

  const forwardingRaw = Array.isArray(pick(toRecord(forwardingResult), "forwardingEvents", "forwarding_events"))
    ? (pick(toRecord(forwardingResult), "forwardingEvents", "forwarding_events") as unknown[])
    : [];
  const forwardingHistory = forwardingRaw
    .map(normalizeForwardingEvent)
    .sort((a, b) => {
      const byTs = compareNumberLike(a.timestampNs ?? a.timestamp, b.timestampNs ?? b.timestamp);
      if (byTs !== 0) return byTs;
      const byIn = compareText(a.chanIdIn || "", b.chanIdIn || "");
      if (byIn !== 0) return byIn;
      return compareText(a.chanIdOut || "", b.chanIdOut || "");
    });

  const peersRaw = Array.isArray(pick(toRecord(peersResult), "peers")) ? (pick(toRecord(peersResult), "peers") as unknown[]) : [];
  const peers = peersRaw
    .map(normalizePeer)
    .sort((a, b) => compareText(a.pubKey || "", b.pubKey || ""));

  const graphRecord = graphResult ? toRecord(graphResult) : null;
  const graphSnapshotRef = buildGraphSnapshotRef(graphRecord);
  const feePolicies = extractFeePolicies(graphRecord);

  return {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc",
    collectedAt: new Date().toISOString(),
    namespace,
    nodeInfo,
    channels,
    forwardingHistory,
    routingFailures: routingFailures.sort((a, b) => {
      const byTs = compareNumberLike(a.timestamp, b.timestamp);
      if (byTs !== 0) return byTs;
      const byIn = compareText(a.incomingChannelId || "", b.incomingChannelId || "");
      if (byIn !== 0) return byIn;
      return compareText(a.outgoingChannelId || "", b.outgoingChannelId || "");
    }),
    feePolicies,
    peers,
    graphSnapshotRef,
  };
}
