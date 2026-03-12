export interface NormalizedChannelState {
  channelId: string;
  remotePubkey: string;
  active: boolean;
  capacitySat: number;
  localBalanceSat: number;
  remoteBalanceSat: number;
  localBalanceRatio: number;
  remoteBalanceRatio: number;
  outboundFeePpm: number | null;
  inboundFeePpm: number | null;
  forwardCountIn: number;
  forwardCountOut: number;
  forwardCountTotal: number;
  revenueSat: number;
  failedForwardCount: number;
  lastActivityTimestamp: number | null;
  peerBetweennessCentrality: number | null;
  missionSuccessRate: number | null;
  missionFailureRate: number | null;
  missionLastSuccessTimestamp: number | null;
  missionLastFailTimestamp: number | null;
  networkInAvg: number | null;
  networkOutAvg: number | null;
}

export interface NormalizedPeerAggregate {
  peerPubkey: string;
  channelCount: number;
  activeChannelCount: number;
  totalCapacitySat: number;
  totalLocalBalanceSat: number;
  totalRemoteBalanceSat: number;
  avgLocalBalanceRatio: number;
  avgRemoteBalanceRatio: number;
  avgOutboundFeePpm: number | null;
  totalForwardCount: number;
  totalRevenueSat: number;
  totalFailedForwardCount: number;
  lastActivityTimestamp: number | null;
  avgPeerBetweennessCentrality: number | null;
  missionPairCount: number;
  missionSuccessRate: number | null;
  missionFailureRate: number | null;
  missionLastSuccessTimestamp: number | null;
  missionLastFailTimestamp: number | null;
}

export interface NormalizedPotentialPeer {
  pubkey: string;
  alias: string;
  capacitySat: number;
  channelCount: number;
  betweennessCentrality: number | null;
  missionSuccessRate: number | null;
  missionFailureRate: number | null;
  lastActivityTimestamp: number | null;
}

export interface NormalizedNodeState {
  schemaVersion: "normalized-node-state-v1";
  sourceType: "lnc";
  sourceSnapshotSchemaVersion: "lightning-snapshot-v1";
  nodePubkey: string;
  nodeAlias: string;
  collectedAt: string;
  channelCount: number;
  channels: NormalizedChannelState[];
  peers: NormalizedPeerAggregate[];
  potentialPeers: NormalizedPotentialPeer[];
  totals: {
    capacitySat: number;
    localBalanceSat: number;
    remoteBalanceSat: number;
    forwardCount: number;
    revenueSat: number;
    failedForwardCount: number;
    missionPairCount: number;
    missionPairsWithSignals: number;
    centralityPeerCount: number;
  };
}
