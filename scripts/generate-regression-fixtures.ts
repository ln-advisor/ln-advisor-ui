import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LightningSnapshot } from "../src/connectors/types";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import { scoreNodeState } from "../src/scoring/scoreNodeState";
import { DEFAULT_PINNED_MODEL_MANIFEST } from "../src/scoring/modelManifest";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";
import { buildArb } from "../src/arb/buildArb";
import { verifyArb } from "../src/arb/verifyArb";

const FIXTURE_ROOT = path.resolve(process.cwd(), "tests", "fixtures");
const DEV_SIGNING_KEY = "fixture-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const stableJson = (value: unknown): string => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const buildNormalizedProjection = (normalized: ReturnType<typeof normalizeSnapshot>) => ({
  schemaVersion: "expected-normalized-v1",
  channelCount: normalized.channelCount,
  totals: normalized.totals,
  channels: [...normalized.channels]
    .sort((a, b) => compareText(a.channelId, b.channelId))
    .map((channel) => ({
      channelId: channel.channelId,
      active: channel.active,
      localBalanceRatio: channel.localBalanceRatio,
      remoteBalanceRatio: channel.remoteBalanceRatio,
      outboundFeePpm: channel.outboundFeePpm,
      inboundFeePpm: channel.inboundFeePpm,
      forwardCountTotal: channel.forwardCountTotal,
      revenueSat: channel.revenueSat,
      failedForwardCount: channel.failedForwardCount,
      lastActivityTimestamp: channel.lastActivityTimestamp,
      peerBetweennessCentrality: channel.peerBetweennessCentrality,
      missionSuccessRate: channel.missionSuccessRate,
      missionFailureRate: channel.missionFailureRate,
      missionLastSuccessTimestamp: channel.missionLastSuccessTimestamp,
      missionLastFailTimestamp: channel.missionLastFailTimestamp,
    })),
  peers: [...normalized.peers]
    .sort((a, b) => compareText(a.peerPubkey, b.peerPubkey))
    .map((peer) => ({
      peerPubkey: peer.peerPubkey,
      channelCount: peer.channelCount,
      avgLocalBalanceRatio: peer.avgLocalBalanceRatio,
      avgRemoteBalanceRatio: peer.avgRemoteBalanceRatio,
      avgOutboundFeePpm: peer.avgOutboundFeePpm,
      totalForwardCount: peer.totalForwardCount,
      totalRevenueSat: peer.totalRevenueSat,
      totalFailedForwardCount: peer.totalFailedForwardCount,
      lastActivityTimestamp: peer.lastActivityTimestamp,
      avgPeerBetweennessCentrality: peer.avgPeerBetweennessCentrality,
      missionPairCount: peer.missionPairCount,
      missionSuccessRate: peer.missionSuccessRate,
      missionFailureRate: peer.missionFailureRate,
      missionLastSuccessTimestamp: peer.missionLastSuccessTimestamp,
      missionLastFailTimestamp: peer.missionLastFailTimestamp,
    })),
});

const buildFeatureProjection = (featureOnly: ReturnType<typeof applyPrivacyPolicy>) => {
  if (featureOnly.privacyMode !== "feature_only") {
    throw new Error(`Expected feature_only mode, got: ${featureOnly.privacyMode}`);
  }

  return {
    schemaVersion: "expected-privacy-feature-v1",
    privacyMode: featureOnly.privacyMode,
    channelCount: featureOnly.channelCount,
    totals: featureOnly.totals,
    channels: [...featureOnly.channels]
      .sort((a, b) => compareText(a.channelRef, b.channelRef))
      .map((channel) => ({
        channelRef: channel.channelRef,
        peerRef: channel.peerRef,
        active: channel.active,
        localBalanceRatio: channel.localBalanceRatio,
        remoteBalanceRatio: channel.remoteBalanceRatio,
        outboundFeePpm: channel.outboundFeePpm,
        inboundFeePpm: channel.inboundFeePpm,
        forwardCountTotal: channel.forwardCountTotal,
        revenueSat: channel.revenueSat,
        failedForwardCount: channel.failedForwardCount,
        peerBetweennessCentrality: channel.peerBetweennessCentrality,
        missionSuccessRate: channel.missionSuccessRate,
        missionFailureRate: channel.missionFailureRate,
      })),
    peers: [...featureOnly.peers]
      .sort((a, b) => compareText(a.peerRef, b.peerRef))
      .map((peer) => ({
        peerRef: peer.peerRef,
        channelCount: peer.channelCount,
        avgLocalBalanceRatio: peer.avgLocalBalanceRatio,
        avgRemoteBalanceRatio: peer.avgRemoteBalanceRatio,
        avgOutboundFeePpm: peer.avgOutboundFeePpm,
        totalForwardCount: peer.totalForwardCount,
        totalRevenueSat: peer.totalRevenueSat,
        totalFailedForwardCount: peer.totalFailedForwardCount,
        avgPeerBetweennessCentrality: peer.avgPeerBetweennessCentrality,
        missionPairCount: peer.missionPairCount,
        missionSuccessRate: peer.missionSuccessRate,
        missionFailureRate: peer.missionFailureRate,
      })),
  };
};

const buildBandedProjection = (banded: ReturnType<typeof applyPrivacyPolicy>) => {
  if (banded.privacyMode !== "banded") {
    throw new Error(`Expected banded mode, got: ${banded.privacyMode}`);
  }

  return {
    schemaVersion: "expected-privacy-banded-v1",
    privacyMode: banded.privacyMode,
    channelCount: banded.channelCount,
    totals: banded.totals,
    channels: [...banded.channels]
      .sort((a, b) => compareText(a.channelRef, b.channelRef))
      .map((channel) => ({
        channelRef: channel.channelRef,
        peerRef: channel.peerRef,
        active: channel.active,
        liquidityBand: channel.liquidityBand,
        channelPerformanceBand: channel.channelPerformanceBand,
        feeCompetitivenessBand: channel.feeCompetitivenessBand,
        failedForwardPressure: channel.failedForwardPressure,
        missionReliabilityBand: channel.missionReliabilityBand,
        centralityBand: channel.centralityBand,
      })),
    peers: [...banded.peers]
      .sort((a, b) => compareText(a.peerRef, b.peerRef))
      .map((peer) => ({
        peerRef: peer.peerRef,
        channelCount: peer.channelCount,
        activeChannelCount: peer.activeChannelCount,
        liquidityBand: peer.liquidityBand,
        channelPerformanceBand: peer.channelPerformanceBand,
        feeCompetitivenessBand: peer.feeCompetitivenessBand,
        failedForwardPressure: peer.failedForwardPressure,
        missionReliabilityBand: peer.missionReliabilityBand,
        centralityBand: peer.centralityBand,
      })),
  };
};

const buildRecommendationProjection = (
  recommendation: ReturnType<typeof scoreNodeState>,
  arb: ReturnType<typeof buildArb>,
  verifyPass: boolean
) => ({
  schemaVersion: "expected-recommendation-bundle-v1",
  modelVersion: recommendation.modelVersion,
  feeActions: [...recommendation.feeRecommendations]
    .sort((a, b) => compareText(a.channelRef, b.channelRef))
    .map((item) => ({
      channelRef: item.channelRef,
      peerRef: item.peerRef,
      action: item.action,
      suggestedFeePpm: item.suggestedFeePpm,
    })),
  rankingOrder: [...recommendation.forwardOpportunityRanking]
    .sort((a, b) => a.rank - b.rank || compareText(a.channelRef, b.channelRef))
    .map((item) => item.channelRef),
  arb: {
    arbVersion: arb.arbVersion,
    recommendationType: arb.recommendationType,
    privacyPolicyId: arb.privacyPolicyId,
    modelVersion: arb.modelVersion,
    modelManifestHash: arb.modelManifestHash,
    modelPinningMode: arb.modelPinningMode,
    signatureAlgorithm: arb.signature.algorithm,
    verificationPass: verifyPass,
  },
});

const scenarios: Record<string, LightningSnapshot> = {
  "small-node": {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc",
    collectedAt: "2026-01-01T00:00:00.000Z",
    namespace: "fixture-small",
    nodeInfo: {
      identityPubkey: "02aa000000000000000000000000000000000000000000000000000000000001",
      alias: "fixture-small-node",
    },
    channels: [
      {
        chanId: "101x1x0",
        remotePubkey: "03aa110000000000000000000000000000000000000000000000000000000011",
        active: true,
        capacity: "100000",
        localBalance: "50000",
        remoteBalance: "50000",
      },
    ],
    forwardingHistory: [
      {
        timestamp: "1700000000",
        timestampNs: "1700000000000000000",
        chanIdIn: "101x1x0",
        chanIdOut: "101x1x0",
        amtIn: "10000",
        amtOut: "9990",
        fee: "10",
      },
    ],
    routingFailures: [],
    feePolicies: [
      {
        channelId: "101x1x0",
        directionPubKey: "02aa000000000000000000000000000000000000000000000000000000000001",
        feeRatePpm: "500",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "101x1x0",
        directionPubKey: "03aa110000000000000000000000000000000000000000000000000000000011",
        feeRatePpm: "700",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
    ],
    graphSnapshotRef: {
      source: "describeGraph",
      fetchedAt: "2026-01-01T00:00:05.000Z",
      includeUnannounced: false,
      includeAuthProof: false,
      nodeCount: 100,
      edgeCount: 150,
    },
  },
  "medium-node": {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc",
    collectedAt: "2026-01-01T01:00:00.000Z",
    namespace: "fixture-medium",
    nodeInfo: {
      identityPubkey: "02bb000000000000000000000000000000000000000000000000000000000002",
      alias: "fixture-medium-node",
    },
    channels: [
      {
        chanId: "201x1x0",
        remotePubkey: "03bb110000000000000000000000000000000000000000000000000000000011",
        active: true,
        capacity: "1000000",
        localBalance: "600000",
        remoteBalance: "400000",
      },
      {
        chanId: "202x1x0",
        remotePubkey: "03bb220000000000000000000000000000000000000000000000000000000022",
        active: true,
        capacity: "2000000",
        localBalance: "700000",
        remoteBalance: "1300000",
      },
      {
        chanId: "203x1x0",
        remotePubkey: "03bb330000000000000000000000000000000000000000000000000000000033",
        active: true,
        capacity: "500000",
        localBalance: "300000",
        remoteBalance: "200000",
      },
    ],
    forwardingHistory: [
      {
        timestamp: "1700001000",
        timestampNs: "1700001000000000000",
        chanIdIn: "202x1x0",
        chanIdOut: "201x1x0",
        amtIn: "120000",
        amtOut: "119850",
        fee: "150",
      },
      {
        timestamp: "1700001300",
        timestampNs: "1700001300000000000",
        chanIdIn: "201x1x0",
        chanIdOut: "202x1x0",
        amtIn: "90000",
        amtOut: "89880",
        fee: "120",
      },
      {
        timestamp: "1700001600",
        timestampNs: "1700001600000000000",
        chanIdIn: "202x1x0",
        chanIdOut: "203x1x0",
        amtIn: "50000",
        amtOut: "49940",
        fee: "60",
      },
      {
        timestamp: "1700001900",
        timestampNs: "1700001900000000000",
        chanIdIn: "203x1x0",
        chanIdOut: "201x1x0",
        amtIn: "40000",
        amtOut: "39955",
        fee: "45",
      },
      {
        timestamp: "1700002200",
        timestampNs: "1700002200000000000",
        chanIdIn: "201x1x0",
        chanIdOut: "203x1x0",
        amtIn: "25000",
        amtOut: "24970",
        fee: "30",
      },
    ],
    routingFailures: [
      {
        timestamp: "1700002300",
        incomingChannelId: "202x1x0",
        outgoingChannelId: "201x1x0",
        failureCode: "TEMPORARY_CHANNEL_FAILURE",
        failureDetail: "Transient path issue",
      },
    ],
    feePolicies: [
      {
        channelId: "201x1x0",
        directionPubKey: "02bb000000000000000000000000000000000000000000000000000000000002",
        feeRatePpm: "250",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "201x1x0",
        directionPubKey: "03bb110000000000000000000000000000000000000000000000000000000011",
        feeRatePpm: "450",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "202x1x0",
        directionPubKey: "02bb000000000000000000000000000000000000000000000000000000000002",
        feeRatePpm: "700",
        feeBaseMsat: "1000",
        timeLockDelta: 48,
        disabled: false,
      },
      {
        channelId: "202x1x0",
        directionPubKey: "03bb220000000000000000000000000000000000000000000000000000000022",
        feeRatePpm: "300",
        feeBaseMsat: "1000",
        timeLockDelta: 48,
        disabled: false,
      },
      {
        channelId: "203x1x0",
        directionPubKey: "02bb000000000000000000000000000000000000000000000000000000000002",
        feeRatePpm: "900",
        feeBaseMsat: "1200",
        timeLockDelta: 60,
        disabled: false,
      },
      {
        channelId: "203x1x0",
        directionPubKey: "03bb330000000000000000000000000000000000000000000000000000000033",
        feeRatePpm: "1100",
        feeBaseMsat: "1200",
        timeLockDelta: 60,
        disabled: false,
      },
    ],
    graphSnapshotRef: {
      source: "describeGraph",
      fetchedAt: "2026-01-01T01:00:05.000Z",
      includeUnannounced: false,
      includeAuthProof: false,
      nodeCount: 200,
      edgeCount: 350,
    },
  },
  "noisy-node": {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc",
    collectedAt: "2026-01-01T02:00:00.000Z",
    namespace: "fixture-noisy",
    nodeInfo: {
      identityPubkey: "02cc000000000000000000000000000000000000000000000000000000000003",
      alias: "fixture-noisy-node",
    },
    channels: [
      {
        chanId: "301x1x0",
        remotePubkey: "03cc110000000000000000000000000000000000000000000000000000000011",
        active: true,
        capacity: "1000000",
        localBalance: "200000",
        remoteBalance: "800000",
      },
      {
        chanId: "302x1x0",
        remotePubkey: "03cc220000000000000000000000000000000000000000000000000000000022",
        active: true,
        capacity: "1500000",
        localBalance: "1200000",
        remoteBalance: "300000",
      },
      {
        chanId: "303x1x0",
        remotePubkey: "03cc330000000000000000000000000000000000000000000000000000000033",
        active: true,
        capacity: "800000",
        localBalance: "400000",
        remoteBalance: "400000",
      },
      {
        chanId: "304x1x0",
        remotePubkey: "03cc440000000000000000000000000000000000000000000000000000000044",
        active: false,
        capacity: "600000",
        localBalance: "100000",
        remoteBalance: "500000",
      },
    ],
    forwardingHistory: [
      {
        timestamp: "1700003000",
        timestampNs: "1700003000000000000",
        chanIdIn: "302x1x0",
        chanIdOut: "301x1x0",
        amtIn: "200000",
        amtOut: "199700",
        fee: "300",
      },
      {
        timestamp: "1700003050",
        timestampNs: "1700003050000000000",
        chanIdIn: "301x1x0",
        chanIdOut: "303x1x0",
        amtIn: "180000",
        amtOut: "179820",
        fee: "180",
      },
      {
        timestamp: "1700003100",
        timestampNs: "1700003100000000000",
        chanIdIn: "303x1x0",
        chanIdOut: "302x1x0",
        amtIn: "170000",
        amtOut: "169830",
        fee: "170",
      },
      {
        timestamp: "1700003400",
        timestampNs: "1700003400000000000",
        chanIdIn: "302x1x0",
        chanIdOut: "301x1x0",
        amtIn: "160000",
        amtOut: "159760",
        fee: "240",
      },
      {
        timestamp: "1700003700",
        timestampNs: "1700003700000000000",
        chanIdIn: "303x1x0",
        chanIdOut: "301x1x0",
        amtIn: "90000",
        amtOut: "89865",
        fee: "135",
      },
      {
        timestamp: "1700004000",
        timestampNs: "1700004000000000000",
        chanIdIn: "301x1x0",
        chanIdOut: "302x1x0",
        amtIn: "120000",
        amtOut: "119820",
        fee: "180",
      },
      {
        timestamp: "1700004300",
        timestampNs: "1700004300000000000",
        chanIdIn: "304x1x0",
        chanIdOut: "303x1x0",
        amtIn: "70000",
        amtOut: "69920",
        fee: "80",
      },
      {
        timestamp: "1700004600",
        timestampNs: "1700004600000000000",
        chanIdIn: "302x1x0",
        chanIdOut: "303x1x0",
        amtIn: "60000",
        amtOut: "59915",
        fee: "85",
      },
    ],
    routingFailures: [
      {
        timestamp: "1700004650",
        incomingChannelId: "301x1x0",
        outgoingChannelId: "304x1x0",
        failureCode: "TEMPORARY_CHANNEL_FAILURE",
        failureDetail: "Liquidity exhausted on inactive route",
      },
      {
        timestamp: "1700004700",
        incomingChannelId: "302x1x0",
        outgoingChannelId: "301x1x0",
        failureCode: "FEE_INSUFFICIENT",
        failureDetail: "Fee quote unstable",
      },
      {
        timestamp: "1700004750",
        incomingChannelId: "302x1x0",
        outgoingChannelId: "304x1x0",
        failureCode: "UNKNOWN_NEXT_PEER",
        failureDetail: "Peer flapping",
      },
      {
        timestamp: "1700004800",
        incomingChannelId: "304x1x0",
        outgoingChannelId: "301x1x0",
        failureCode: "TEMPORARY_NODE_FAILURE",
        failureDetail: "Node overloaded",
      },
    ],
    feePolicies: [
      {
        channelId: "301x1x0",
        directionPubKey: "02cc000000000000000000000000000000000000000000000000000000000003",
        feeRatePpm: "220",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "301x1x0",
        directionPubKey: "03cc110000000000000000000000000000000000000000000000000000000011",
        feeRatePpm: "450",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "302x1x0",
        directionPubKey: "02cc000000000000000000000000000000000000000000000000000000000003",
        feeRatePpm: "1400",
        feeBaseMsat: "1500",
        timeLockDelta: 72,
        disabled: false,
      },
      {
        channelId: "302x1x0",
        directionPubKey: "03cc220000000000000000000000000000000000000000000000000000000022",
        feeRatePpm: "650",
        feeBaseMsat: "1500",
        timeLockDelta: 72,
        disabled: false,
      },
      {
        channelId: "303x1x0",
        directionPubKey: "02cc000000000000000000000000000000000000000000000000000000000003",
        feeRatePpm: "600",
        feeBaseMsat: "1200",
        timeLockDelta: 55,
        disabled: false,
      },
      {
        channelId: "303x1x0",
        directionPubKey: "03cc330000000000000000000000000000000000000000000000000000000033",
        feeRatePpm: "700",
        feeBaseMsat: "1200",
        timeLockDelta: 55,
        disabled: false,
      },
      {
        channelId: "304x1x0",
        directionPubKey: "02cc000000000000000000000000000000000000000000000000000000000003",
        feeRatePpm: "1800",
        feeBaseMsat: "2000",
        timeLockDelta: 80,
        disabled: true,
      },
      {
        channelId: "304x1x0",
        directionPubKey: "03cc440000000000000000000000000000000000000000000000000000000044",
        feeRatePpm: "900",
        feeBaseMsat: "2000",
        timeLockDelta: 80,
        disabled: false,
      },
    ],
    graphSnapshotRef: {
      source: "describeGraph",
      fetchedAt: "2026-01-01T02:00:05.000Z",
      includeUnannounced: false,
      includeAuthProof: false,
      nodeCount: 350,
      edgeCount: 620,
    },
  },
  "imbalanced-node": {
    schemaVersion: "lightning-snapshot-v1",
    sourceType: "lnc",
    collectedAt: "2026-01-01T03:00:00.000Z",
    namespace: "fixture-imbalanced",
    nodeInfo: {
      identityPubkey: "02dd000000000000000000000000000000000000000000000000000000000004",
      alias: "fixture-imbalanced-node",
    },
    channels: [
      {
        chanId: "401x1x0",
        remotePubkey: "03dd110000000000000000000000000000000000000000000000000000000011",
        active: true,
        capacity: "2000000",
        localBalance: "1900000",
        remoteBalance: "100000",
      },
      {
        chanId: "402x1x0",
        remotePubkey: "03dd220000000000000000000000000000000000000000000000000000000022",
        active: true,
        capacity: "2000000",
        localBalance: "150000",
        remoteBalance: "1850000",
      },
      {
        chanId: "403x1x0",
        remotePubkey: "03dd330000000000000000000000000000000000000000000000000000000033",
        active: true,
        capacity: "1000000",
        localBalance: "500000",
        remoteBalance: "500000",
      },
    ],
    forwardingHistory: [
      {
        timestamp: "1700006000",
        timestampNs: "1700006000000000000",
        chanIdIn: "401x1x0",
        chanIdOut: "402x1x0",
        amtIn: "150000",
        amtOut: "149700",
        fee: "300",
      },
      {
        timestamp: "1700006300",
        timestampNs: "1700006300000000000",
        chanIdIn: "403x1x0",
        chanIdOut: "402x1x0",
        amtIn: "80000",
        amtOut: "79880",
        fee: "120",
      },
      {
        timestamp: "1700006600",
        timestampNs: "1700006600000000000",
        chanIdIn: "402x1x0",
        chanIdOut: "403x1x0",
        amtIn: "50000",
        amtOut: "49925",
        fee: "75",
      },
    ],
    routingFailures: [
      {
        timestamp: "1700006650",
        incomingChannelId: "402x1x0",
        outgoingChannelId: "401x1x0",
        failureCode: "TEMPORARY_CHANNEL_FAILURE",
        failureDetail: "Outbound shortage on remote-heavy channel",
      },
    ],
    feePolicies: [
      {
        channelId: "401x1x0",
        directionPubKey: "02dd000000000000000000000000000000000000000000000000000000000004",
        feeRatePpm: "1500",
        feeBaseMsat: "1200",
        timeLockDelta: 60,
        disabled: false,
      },
      {
        channelId: "401x1x0",
        directionPubKey: "03dd110000000000000000000000000000000000000000000000000000000011",
        feeRatePpm: "900",
        feeBaseMsat: "1200",
        timeLockDelta: 60,
        disabled: false,
      },
      {
        channelId: "402x1x0",
        directionPubKey: "02dd000000000000000000000000000000000000000000000000000000000004",
        feeRatePpm: "200",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "402x1x0",
        directionPubKey: "03dd220000000000000000000000000000000000000000000000000000000022",
        feeRatePpm: "500",
        feeBaseMsat: "1000",
        timeLockDelta: 40,
        disabled: false,
      },
      {
        channelId: "403x1x0",
        directionPubKey: "02dd000000000000000000000000000000000000000000000000000000000004",
        feeRatePpm: "600",
        feeBaseMsat: "1000",
        timeLockDelta: 48,
        disabled: false,
      },
      {
        channelId: "403x1x0",
        directionPubKey: "03dd330000000000000000000000000000000000000000000000000000000033",
        feeRatePpm: "650",
        feeBaseMsat: "1000",
        timeLockDelta: 48,
        disabled: false,
      },
    ],
    graphSnapshotRef: {
      source: "describeGraph",
      fetchedAt: "2026-01-01T03:00:05.000Z",
      includeUnannounced: false,
      includeAuthProof: false,
      nodeCount: 180,
      edgeCount: 290,
    },
  },
};

const writeScenario = async (scenario: string, rawSnapshot: LightningSnapshot): Promise<void> => {
  const scenarioDir = path.resolve(FIXTURE_ROOT, scenario);
  await mkdir(scenarioDir, { recursive: true });

  const normalized = normalizeSnapshot(rawSnapshot);
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const banded = applyPrivacyPolicy(normalized, "banded");
  const recommendation = scoreNodeState(featureOnly, {
    nodePubkey: normalized.nodePubkey,
    nodeAlias: normalized.nodeAlias,
    collectedAt: normalized.collectedAt,
  });
  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalized, {
    modelManifest: DEFAULT_PINNED_MODEL_MANIFEST,
    privacyTransformedSnapshot: featureOnly,
  });
  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: DEV_SIGNING_KEY,
    modelManifest: DEFAULT_PINNED_MODEL_MANIFEST,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyResult = verifyArb({
    arb,
    sourceProvenance: provenance,
    devSigningKey: DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  if (!verifyResult.ok) {
    throw new Error(`Generated ARB did not verify for ${scenario}: ${verifyResult.errors.join(" | ")}`);
  }

  await writeFile(path.resolve(scenarioDir, "lightning-snapshot.raw.json"), stableJson(rawSnapshot), "utf8");
  await writeFile(
    path.resolve(scenarioDir, "expected.normalized.json"),
    stableJson(buildNormalizedProjection(normalized)),
    "utf8"
  );
  await writeFile(
    path.resolve(scenarioDir, "expected.privacy.feature-only.json"),
    stableJson(buildFeatureProjection(featureOnly)),
    "utf8"
  );
  await writeFile(
    path.resolve(scenarioDir, "expected.privacy.banded.json"),
    stableJson(buildBandedProjection(banded)),
    "utf8"
  );
  await writeFile(
    path.resolve(scenarioDir, "expected.recommendation-bundle.json"),
    stableJson(buildRecommendationProjection(recommendation, arb, true)),
    "utf8"
  );

  console.log(`Wrote fixture: ${scenario}`);
};

async function main(): Promise<void> {
  for (const [scenario, snapshot] of Object.entries(scenarios).sort(([a], [b]) => compareText(a, b))) {
    await writeScenario(scenario, snapshot);
  }
  console.log(`Fixture generation complete: ${Object.keys(scenarios).length} scenarios.`);
}

main().catch((error) => {
  console.error("Failed to generate regression fixtures.", error);
  process.exitCode = 1;
});
