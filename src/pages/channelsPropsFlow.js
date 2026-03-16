const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const makeChannelRef = (index) => `channel_${String(index + 1).padStart(4, '0')}`;

const normalizeChannelId = (channel) => String(channel?.chanId || channel?.chan_id || '').trim();

const capitalizeAction = (value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'Hold';
    return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
};

export const buildChannelRefMap = (channels = []) => {
    const sorted = [...channels]
        .map((channel) => ({
            channelId: normalizeChannelId(channel),
        }))
        .filter((channel) => channel.channelId.length > 0)
        .sort((a, b) => compareText(a.channelId, b.channelId));

    const map = new Map();
    sorted.forEach((channel, index) => {
        map.set(channel.channelId, makeChannelRef(index));
    });
    return map;
};

export const buildFeePoliciesFromChanInfoMap = (chanInfoMap = {}) => {
    const policies = [];
    Object.entries(chanInfoMap).forEach(([channelId, info]) => {
        if (!info || typeof info !== 'object') return;

        const node1Pub = String(info.node1_pub || info.node1Pub || '').trim();
        const node2Pub = String(info.node2_pub || info.node2Pub || '').trim();
        const node1Policy = info.node1_policy || info.node1Policy;
        const node2Policy = info.node2_policy || info.node2Policy;

        if (node1Pub && node1Policy) {
            policies.push({
                channelId,
                directionPubKey: node1Pub,
                ...node1Policy,
            });
        }

        if (node2Pub && node2Policy) {
            policies.push({
                channelId,
                directionPubKey: node2Pub,
                ...node2Policy,
            });
        }
    });

    return policies.sort((a, b) => {
        const byChannel = compareText(String(a.channelId || ''), String(b.channelId || ''));
        if (byChannel !== 0) return byChannel;
        return compareText(String(a.directionPubKey || ''), String(b.directionPubKey || ''));
    });
};

export const createChannelTelemetryPreview = ({
    selectedChannel,
    getFeeRatePpm,
    peerFeeStats,
    peerOutFeeStats,
    peerFeeSeries,
}) => ({
    channelId: selectedChannel.chanId,
    peerPubkey: selectedChannel.peerPubkey,
    capacity: selectedChannel.capacity,
    localBalance: selectedChannel.local,
    remoteBalance: selectedChannel.remote,
    routingStatsOutMsat: selectedChannel.stats.feeOutMsat,
    routingStatsInMsat: selectedChannel.stats.feeInMsat,
    myFeeRate: getFeeRatePpm(selectedChannel.myPolicy),
    peerFeeRate: getFeeRatePpm(selectedChannel.peerPolicy),
    networkInAvg: peerFeeStats?.correctedAvg,
    networkInMin: peerFeeStats?.min,
    networkInMax: peerFeeStats?.max,
    networkInMedian: peerFeeStats?.median,
    networkOutAvg: peerOutFeeStats?.correctedAvg,
    networkOutMin: peerOutFeeStats?.min,
    networkOutMax: peerOutFeeStats?.max,
    networkOutMedian: peerOutFeeStats?.median,
    peerFeeSeries: { ...peerFeeSeries },
});

export const selectChannelPropsRecommendation = ({
    recommendResponse,
    verifyResponse,
    selectedChannelId,
    nodeChannels,
    fallbackFeePpm,
}) => {
    const channelRef = buildChannelRefMap(nodeChannels).get(String(selectedChannelId || '').trim());
    if (!channelRef) return null;

    const rows = Array.isArray(recommendResponse?.recommendation?.feeRecommendations)
        ? recommendResponse.recommendation.feeRecommendations
        : [];
    const row = rows.find((item) => item?.channelRef === channelRef);
    if (!row) return null;

    const suggestedFeePpm =
        row.suggestedFeePpm !== null && row.suggestedFeePpm !== undefined
            ? row.suggestedFeePpm
            : row.currentFeePpm !== null && row.currentFeePpm !== undefined
                ? row.currentFeePpm
                : fallbackFeePpm;

    return {
        action: capitalizeAction(row.action),
        suggestedPpm: suggestedFeePpm,
        confidenceScore: Number(row.confidence || 0),
        reasonCodes: Array.isArray(row.reasons) ? row.reasons : [],
        channelRef,
        verifyOk: Boolean(verifyResponse?.ok),
        verifyErrors: Array.isArray(verifyResponse?.errors) ? verifyResponse.errors : [],
        verifyWarnings: Array.isArray(verifyResponse?.warnings) ? verifyResponse.warnings : [],
        signingMode: recommendResponse?.signingMode || null,
        modelVersion:
            recommendResponse?.arb?.modelVersion ||
            recommendResponse?.recommendation?.modelVersion ||
            null,
        arb: recommendResponse?.arb || null,
        sourceProvenance: recommendResponse?.sourceProvenance || null,
    };
};
