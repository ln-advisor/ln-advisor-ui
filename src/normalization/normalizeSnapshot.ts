import type { LightningSnapshot, NumericLike } from "../connectors/types";
import type {
  NormalizedChannelState,
  NormalizedNodeState,
  NormalizedPeerAggregate,
} from "./types";

interface ChannelAccumulator {
  forwardCountIn: number;
  forwardCountOut: number;
  revenueSat: number;
  failedForwardCount: number;
  lastActivityTimestamp: number | null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const toNumber = (value: NumericLike | undefined | null): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toTimestampSeconds = (
  timestampNsLike: NumericLike | undefined | null,
  timestampLike: NumericLike | undefined | null
): number | null => {
  const timestampNs = toNumber(timestampNsLike);
  if (timestampNs > 0) {
    return Math.floor(timestampNs / 1_000_000_000);
  }
  const timestamp = toNumber(timestampLike);
  if (timestamp > 0) {
    return Math.floor(timestamp);
  }
  return null;
};

const roundFixed = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const updateActivity = (existing: number | null, incoming: number | null): number | null => {
  if (existing === null) return incoming;
  if (incoming === null) return existing;
  return incoming > existing ? incoming : existing;
};

const ensureChannelAccumulator = (
  map: Map<string, ChannelAccumulator>,
  channelId: string
): ChannelAccumulator => {
  if (!map.has(channelId)) {
    map.set(channelId, {
      forwardCountIn: 0,
      forwardCountOut: 0,
      revenueSat: 0,
      failedForwardCount: 0,
      lastActivityTimestamp: null,
    });
  }
  return map.get(channelId)!;
};

const buildForwardingStats = (snapshot: LightningSnapshot): Map<string, ChannelAccumulator> => {
  const channelStats = new Map<string, ChannelAccumulator>();

  for (const event of snapshot.forwardingHistory || []) {
    const channelIn = String(event.chanIdIn || "").trim();
    const channelOut = String(event.chanIdOut || "").trim();
    const feeSat = toNumber(event.fee);
    const ts = toTimestampSeconds(event.timestampNs, event.timestamp);

    if (channelIn) {
      const accIn = ensureChannelAccumulator(channelStats, channelIn);
      accIn.forwardCountIn += 1;
      accIn.lastActivityTimestamp = updateActivity(accIn.lastActivityTimestamp, ts);
    }

    if (channelOut) {
      const accOut = ensureChannelAccumulator(channelStats, channelOut);
      accOut.forwardCountOut += 1;
      accOut.revenueSat += feeSat;
      accOut.lastActivityTimestamp = updateActivity(accOut.lastActivityTimestamp, ts);
    }
  }

  return channelStats;
};

const buildFailureStats = (
  snapshot: LightningSnapshot,
  channelStats: Map<string, ChannelAccumulator>
): void => {
  for (const failure of snapshot.routingFailures || []) {
    const incoming = String(failure.incomingChannelId || "").trim();
    const outgoing = String(failure.outgoingChannelId || "").trim();
    const ts = toTimestampSeconds(undefined, failure.timestamp);

    if (incoming) {
      const inAcc = ensureChannelAccumulator(channelStats, incoming);
      inAcc.failedForwardCount += 1;
      inAcc.lastActivityTimestamp = updateActivity(inAcc.lastActivityTimestamp, ts);
    }

    if (outgoing && outgoing !== incoming) {
      const outAcc = ensureChannelAccumulator(channelStats, outgoing);
      outAcc.failedForwardCount += 1;
      outAcc.lastActivityTimestamp = updateActivity(outAcc.lastActivityTimestamp, ts);
    }
  }
};

const buildFeeMap = (
  snapshot: LightningSnapshot,
  nodePubkey: string
): Map<string, { outboundFeePpm: number | null; inboundFeePpm: number | null }> => {
  const feeMap = new Map<string, { outboundFeePpm: number | null; inboundFeePpm: number | null }>();
  const policies = [...(snapshot.feePolicies || [])].sort((a, b) => {
    const byChannel = compareText(a.channelId, b.channelId);
    if (byChannel !== 0) return byChannel;
    return compareText(a.directionPubKey, b.directionPubKey);
  });

  for (const policy of policies) {
    const channelId = String(policy.channelId || "").trim();
    if (!channelId) continue;
    if (!feeMap.has(channelId)) {
      feeMap.set(channelId, { outboundFeePpm: null, inboundFeePpm: null });
    }
    const current = feeMap.get(channelId)!;
    const feePpm = toNumber(policy.feeRatePpm);
    const directionPubKey = String(policy.directionPubKey || "").trim();
    if (directionPubKey && nodePubkey && directionPubKey === nodePubkey) {
      current.outboundFeePpm = feePpm;
    } else if (current.inboundFeePpm === null) {
      current.inboundFeePpm = feePpm;
    }
  }

  return feeMap;
};

export function normalizeSnapshot(snapshot: LightningSnapshot): NormalizedNodeState {
  const nodePubkey = String(snapshot.nodeInfo?.identityPubkey || "").trim();
  const nodeAlias = String(snapshot.nodeInfo?.alias || "").trim();

  const channelStats = buildForwardingStats(snapshot);
  buildFailureStats(snapshot, channelStats);
  const feeMap = buildFeeMap(snapshot, nodePubkey);

  const channels: NormalizedChannelState[] = [...(snapshot.channels || [])]
    .map((channel) => {
      const channelId = String(channel.chanId || "").trim();
      const capacitySat = toNumber(channel.capacity);
      const localBalanceSat = toNumber(channel.localBalance);
      const remoteBalanceSat = toNumber(channel.remoteBalance);
      const ratiosBase = capacitySat > 0 ? capacitySat : 0;
      const localBalanceRatio = ratiosBase > 0 ? roundFixed(localBalanceSat / ratiosBase, 6) : 0;
      const remoteBalanceRatio = ratiosBase > 0 ? roundFixed(remoteBalanceSat / ratiosBase, 6) : 0;

      const stats = channelStats.get(channelId) || {
        forwardCountIn: 0,
        forwardCountOut: 0,
        revenueSat: 0,
        failedForwardCount: 0,
        lastActivityTimestamp: null,
      };
      const fee = feeMap.get(channelId) || { outboundFeePpm: null, inboundFeePpm: null };

      return {
        channelId,
        remotePubkey: String(channel.remotePubkey || "").trim(),
        active: Boolean(channel.active),
        capacitySat,
        localBalanceSat,
        remoteBalanceSat,
        localBalanceRatio,
        remoteBalanceRatio,
        outboundFeePpm: fee.outboundFeePpm,
        inboundFeePpm: fee.inboundFeePpm,
        forwardCountIn: stats.forwardCountIn,
        forwardCountOut: stats.forwardCountOut,
        forwardCountTotal: stats.forwardCountIn + stats.forwardCountOut,
        revenueSat: roundFixed(stats.revenueSat, 3),
        failedForwardCount: stats.failedForwardCount,
        lastActivityTimestamp: stats.lastActivityTimestamp,
      };
    })
    .sort((a, b) => compareText(a.channelId, b.channelId));

  const peerMap = new Map<
    string,
    {
      channelCount: number;
      activeChannelCount: number;
      totalCapacitySat: number;
      totalLocalBalanceSat: number;
      totalRemoteBalanceSat: number;
      localRatioSum: number;
      remoteRatioSum: number;
      outboundFeePpmSum: number;
      outboundFeePpmCount: number;
      totalForwardCount: number;
      totalRevenueSat: number;
      totalFailedForwardCount: number;
      lastActivityTimestamp: number | null;
    }
  >();

  for (const channel of channels) {
    const peerPubkey = channel.remotePubkey || "unknown-peer";
    if (!peerMap.has(peerPubkey)) {
      peerMap.set(peerPubkey, {
        channelCount: 0,
        activeChannelCount: 0,
        totalCapacitySat: 0,
        totalLocalBalanceSat: 0,
        totalRemoteBalanceSat: 0,
        localRatioSum: 0,
        remoteRatioSum: 0,
        outboundFeePpmSum: 0,
        outboundFeePpmCount: 0,
        totalForwardCount: 0,
        totalRevenueSat: 0,
        totalFailedForwardCount: 0,
        lastActivityTimestamp: null,
      });
    }

    const peerAcc = peerMap.get(peerPubkey)!;
    peerAcc.channelCount += 1;
    peerAcc.activeChannelCount += channel.active ? 1 : 0;
    peerAcc.totalCapacitySat += channel.capacitySat;
    peerAcc.totalLocalBalanceSat += channel.localBalanceSat;
    peerAcc.totalRemoteBalanceSat += channel.remoteBalanceSat;
    peerAcc.localRatioSum += channel.localBalanceRatio;
    peerAcc.remoteRatioSum += channel.remoteBalanceRatio;
    if (channel.outboundFeePpm !== null) {
      peerAcc.outboundFeePpmSum += channel.outboundFeePpm;
      peerAcc.outboundFeePpmCount += 1;
    }
    peerAcc.totalForwardCount += channel.forwardCountTotal;
    peerAcc.totalRevenueSat += channel.revenueSat;
    peerAcc.totalFailedForwardCount += channel.failedForwardCount;
    peerAcc.lastActivityTimestamp = updateActivity(
      peerAcc.lastActivityTimestamp,
      channel.lastActivityTimestamp
    );
  }

  const peers: NormalizedPeerAggregate[] = [...peerMap.entries()]
    .map(([peerPubkey, peerAcc]) => ({
      peerPubkey,
      channelCount: peerAcc.channelCount,
      activeChannelCount: peerAcc.activeChannelCount,
      totalCapacitySat: peerAcc.totalCapacitySat,
      totalLocalBalanceSat: peerAcc.totalLocalBalanceSat,
      totalRemoteBalanceSat: peerAcc.totalRemoteBalanceSat,
      avgLocalBalanceRatio:
        peerAcc.channelCount > 0 ? roundFixed(peerAcc.localRatioSum / peerAcc.channelCount, 6) : 0,
      avgRemoteBalanceRatio:
        peerAcc.channelCount > 0 ? roundFixed(peerAcc.remoteRatioSum / peerAcc.channelCount, 6) : 0,
      avgOutboundFeePpm:
        peerAcc.outboundFeePpmCount > 0
          ? roundFixed(peerAcc.outboundFeePpmSum / peerAcc.outboundFeePpmCount, 3)
          : null,
      totalForwardCount: peerAcc.totalForwardCount,
      totalRevenueSat: roundFixed(peerAcc.totalRevenueSat, 3),
      totalFailedForwardCount: peerAcc.totalFailedForwardCount,
      lastActivityTimestamp: peerAcc.lastActivityTimestamp,
    }))
    .sort((a, b) => compareText(a.peerPubkey, b.peerPubkey));

  const totals = channels.reduce(
    (acc, channel) => {
      acc.capacitySat += channel.capacitySat;
      acc.localBalanceSat += channel.localBalanceSat;
      acc.remoteBalanceSat += channel.remoteBalanceSat;
      acc.forwardCount += channel.forwardCountTotal;
      acc.revenueSat += channel.revenueSat;
      acc.failedForwardCount += channel.failedForwardCount;
      return acc;
    },
    {
      capacitySat: 0,
      localBalanceSat: 0,
      remoteBalanceSat: 0,
      forwardCount: 0,
      revenueSat: 0,
      failedForwardCount: 0,
    }
  );

  return {
    schemaVersion: "normalized-node-state-v1",
    sourceType: "lnc",
    sourceSnapshotSchemaVersion: "lightning-snapshot-v1",
    nodePubkey,
    nodeAlias,
    collectedAt: String(snapshot.collectedAt || ""),
    channelCount: channels.length,
    channels,
    peers,
    totals: {
      ...totals,
      revenueSat: roundFixed(totals.revenueSat, 3),
    },
  };
}

