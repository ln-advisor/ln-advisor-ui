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

interface MissionAccumulator {
  successCount: number;
  failCount: number;
  lastSuccessTimestamp: number | null;
  lastFailTimestamp: number | null;
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

const normalizePubkey = (value: string): string => String(value || "").trim().toLowerCase();

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

const buildCentralityMap = (snapshot: LightningSnapshot): Map<string, number> => {
  const map = new Map<string, number>();
  for (const metric of snapshot.nodeCentralityMetrics || []) {
    const pubkey = normalizePubkey(String(metric.nodePubkey || ""));
    if (!pubkey) continue;
    map.set(pubkey, toNumber(metric.betweennessCentrality));
  }
  return map;
};

const buildMissionMap = (
  snapshot: LightningSnapshot,
  nodePubkey: string
): Map<string, MissionAccumulator> => {
  const map = new Map<string, MissionAccumulator>();
  const node = normalizePubkey(nodePubkey);
  for (const pair of snapshot.missionControlPairs || []) {
    const from = normalizePubkey(String(pair.nodeFrom || ""));
    const to = normalizePubkey(String(pair.nodeTo || ""));
    if (!from || !to) continue;

    let remotePeer = "";
    if (node && from === node) remotePeer = to;
    else if (node && to === node) remotePeer = from;
    else if (!node) remotePeer = to;
    else continue;

    if (!remotePeer) continue;

    const successCount = Math.max(0, Math.floor(toNumber(pair.successCount)));
    const failCount = Math.max(0, Math.floor(toNumber(pair.failCount)));
    const lastSuccessTimestamp = toTimestampSeconds(undefined, pair.lastSuccessTimestamp);
    const lastFailTimestamp = toTimestampSeconds(undefined, pair.lastFailTimestamp);

    if (!map.has(remotePeer)) {
      map.set(remotePeer, {
        successCount: 0,
        failCount: 0,
        lastSuccessTimestamp: null,
        lastFailTimestamp: null,
      });
    }

    const current = map.get(remotePeer)!;
    current.successCount += successCount;
    current.failCount += failCount;
    current.lastSuccessTimestamp = updateActivity(current.lastSuccessTimestamp, lastSuccessTimestamp);
    current.lastFailTimestamp = updateActivity(current.lastFailTimestamp, lastFailTimestamp);
  }
  return map;
};

export function normalizeSnapshot(snapshot: LightningSnapshot): NormalizedNodeState {
  const nodePubkey = String(snapshot.nodeInfo?.identityPubkey || "").trim();
  const nodeAlias = String(snapshot.nodeInfo?.alias || "").trim();

  const channelStats = buildForwardingStats(snapshot);
  buildFailureStats(snapshot, channelStats);
  const feeMap = buildFeeMap(snapshot, nodePubkey);
  const centralityMap = buildCentralityMap(snapshot);
  const missionMap = buildMissionMap(snapshot, nodePubkey);

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
      const remotePubkey = normalizePubkey(String(channel.remotePubkey || "").trim());
      const peerCentrality = centralityMap.has(remotePubkey) ? centralityMap.get(remotePubkey)! : null;
      const mission = missionMap.get(remotePubkey) || {
        successCount: 0,
        failCount: 0,
        lastSuccessTimestamp: null,
        lastFailTimestamp: null,
      };
      const missionTotal = mission.successCount + mission.failCount;

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
        peerBetweennessCentrality:
          peerCentrality === null ? null : roundFixed(Math.max(0, peerCentrality), 9),
        missionSuccessRate:
          missionTotal > 0 ? roundFixed(mission.successCount / missionTotal, 6) : null,
        missionFailureRate:
          missionTotal > 0 ? roundFixed(mission.failCount / missionTotal, 6) : null,
        missionLastSuccessTimestamp: mission.lastSuccessTimestamp,
        missionLastFailTimestamp: mission.lastFailTimestamp,
        networkInAvg: channel.networkInAvg ?? null,
        networkOutAvg: channel.networkOutAvg ?? null,
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
      peerBetweennessCentralitySum: number;
      peerBetweennessCentralityCount: number;
      totalForwardCount: number;
      totalRevenueSat: number;
      totalFailedForwardCount: number;
      lastActivityTimestamp: number | null;
      missionPairCount: number;
      missionSuccessRate: number | null;
      missionFailureRate: number | null;
      missionLastSuccessTimestamp: number | null;
      missionLastFailTimestamp: number | null;
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
          peerBetweennessCentralitySum: 0,
          peerBetweennessCentralityCount: 0,
          totalForwardCount: 0,
          totalRevenueSat: 0,
          totalFailedForwardCount: 0,
          lastActivityTimestamp: null,
          missionPairCount:
            channel.missionSuccessRate !== null || channel.missionFailureRate !== null ? 1 : 0,
          missionSuccessRate: channel.missionSuccessRate,
          missionFailureRate: channel.missionFailureRate,
          missionLastSuccessTimestamp: channel.missionLastSuccessTimestamp,
          missionLastFailTimestamp: channel.missionLastFailTimestamp,
        });
      }

    const peerAcc = peerMap.get(peerPubkey)!;
    if (
      peerAcc.missionPairCount === 0 &&
      (channel.missionSuccessRate !== null || channel.missionFailureRate !== null)
    ) {
      peerAcc.missionPairCount = 1;
      peerAcc.missionSuccessRate = channel.missionSuccessRate;
      peerAcc.missionFailureRate = channel.missionFailureRate;
      peerAcc.missionLastSuccessTimestamp = channel.missionLastSuccessTimestamp;
      peerAcc.missionLastFailTimestamp = channel.missionLastFailTimestamp;
    }
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
    if (channel.peerBetweennessCentrality !== null) {
      peerAcc.peerBetweennessCentralitySum += channel.peerBetweennessCentrality;
      peerAcc.peerBetweennessCentralityCount += 1;
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
      avgPeerBetweennessCentrality:
        peerAcc.peerBetweennessCentralityCount > 0
          ? roundFixed(
              peerAcc.peerBetweennessCentralitySum / peerAcc.peerBetweennessCentralityCount,
              9
            )
          : null,
      missionPairCount: peerAcc.missionPairCount,
      missionSuccessRate: peerAcc.missionSuccessRate,
      missionFailureRate: peerAcc.missionFailureRate,
      missionLastSuccessTimestamp: peerAcc.missionLastSuccessTimestamp,
      missionLastFailTimestamp: peerAcc.missionLastFailTimestamp,
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
      if (channel.missionSuccessRate !== null || channel.missionFailureRate !== null) {
        acc.missionPairsWithSignals += 1;
      }
      if (channel.peerBetweennessCentrality !== null) {
        acc.centralityPeerCount += 1;
      }
      return acc;
    },
    {
      capacitySat: 0,
      localBalanceSat: 0,
      remoteBalanceSat: 0,
      forwardCount: 0,
      revenueSat: 0,
      failedForwardCount: 0,
      missionPairsWithSignals: 0,
      centralityPeerCount: 0,
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
      missionPairCount: missionMap.size,
    },
  };
}
