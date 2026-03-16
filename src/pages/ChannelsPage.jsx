import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    postFeeSuggestion,
    postVerify,
    postAnalyzeGemini,
} from '../api/telemetryClient';
import {
    getPhalaUiConfig,
    runPhalaVerifiedRecommendation,
} from '../api/phalaClient';
import { normalizeSnapshot } from '../normalization/normalizeSnapshot';
import { applyPrivacyPolicy } from '../privacy/applyPrivacyPolicy';

const fmtSats = (n) => {
    const num = Number(n) || 0;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
};

const shortChan = (id) => {
    if (!id) return '—';
    const s = String(id);
    return s.length > 10 ? `…${s.slice(-8)}` : s;
};

const shortHash = (value) => {
    if (!value) return 'â€”';
    const s = String(value);
    return s.length > 18 ? `${s.slice(0, 8)}â€¦${s.slice(-8)}` : s;
};

const jsonByteLength = (value) => {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch (_error) {
        return 0;
    }
};

const getStandardApiBaseUrl = () => String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

const PHALA_UI_CONFIG = getPhalaUiConfig();
const getPhalaTransportBaseUrl = () => import.meta.env.DEV ? '/__phala' : (PHALA_UI_CONFIG.appUrl || '');

const normalizePolicy = (policy) => {
    if (!policy) return null;
    return {
        feeRateMilliMsat: policy.feeRateMilliMsat ?? policy.fee_rate_milli_msat ?? policy.feeRatePpm ?? policy.fee_rate_ppm ?? 0,
        feeBaseMsat: policy.feeBaseMsat ?? policy.fee_base_msat ?? 0,
        timeLockDelta: policy.timeLockDelta ?? policy.time_lock_delta ?? 0,
        minHtlc: policy.minHtlc ?? policy.min_htlc ?? policy.minHtlcMsat ?? policy.min_htlc_msat ?? '0',
        maxHtlcMsat: policy.maxHtlcMsat ?? policy.max_htlc_msat ?? '0',
        disabled: Boolean(policy.disabled),
    };
};

const buildMockChannelInfoMap = (snapshot) => {
    const channels = Array.isArray(snapshot?.channels) ? snapshot.channels : [];
    const feePolicies = Array.isArray(snapshot?.feePolicies) ? snapshot.feePolicies : [];
    const localNodePubkey = String(snapshot?.nodeInfo?.identityPubkey || snapshot?.nodeInfo?.identity_pubkey || '').toLowerCase();
    const policyMap = new Map();

    feePolicies.forEach((policy) => {
        const channelId = String(policy.channelId || policy.channel_id || '');
        if (!channelId) return;
        const entry = policyMap.get(channelId) || [];
        entry.push(policy);
        policyMap.set(channelId, entry);
    });

    return channels.reduce((acc, channel) => {
        const channelId = String(channel.chanId || channel.chan_id || '');
        const remotePubkey = String(channel.remotePubkey || channel.remote_pubkey || '').toLowerCase();
        const policies = policyMap.get(channelId) || [];
        const myPolicy = policies.find((policy) => String(policy.directionPubKey || policy.direction_pub_key || '').toLowerCase() === localNodePubkey) || null;
        const peerPolicy = policies.find((policy) => String(policy.directionPubKey || policy.direction_pub_key || '').toLowerCase() === remotePubkey) || null;

        acc[channelId] = {
            node1_pub: remotePubkey,
            node2_pub: localNodePubkey,
            node1_policy: normalizePolicy(peerPolicy),
            node2_policy: normalizePolicy(myPolicy),
        };

        return acc;
    }, {});
};

const DataModal = ({ isOpen, onClose, title, data, darkMode }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div
                className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl border transition-all duration-300 transform scale-100"
                style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-8 py-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-slate-500/10 transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 font-mono text-sm leading-relaxed" style={{ backgroundColor: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>
                    <pre className="whitespace-pre-wrap break-all" style={{ color: darkMode ? '#94a3b8' : '#334155' }}>
                        {JSON.stringify(data, null, 2)}
                    </pre>
                </div>
                <div className="px-8 py-4 border-t flex justify-end" style={{ borderColor: 'var(--border-color)' }}>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-xl font-bold text-sm text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))' }}
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

const ChannelsPage = ({ lnc, darkMode, nodeChannels = [], mockSnapshot = null }) => {
    const isMockMode = !lnc?.lnd?.lightning && Boolean(mockSnapshot);
    const [chanAliasMap, setChanAliasMap] = useState({});
    const [chanInfoMap, setChanInfoMap] = useState({}); // chanId => { node1_pub, node2_pub, node1_policy, node2_policy }
    const [forwards, setForwards] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [feeModalOpen, setFeeModalOpen] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [peerFeeStats, setPeerFeeStats] = useState(null);
    const [peerOutFeeStats, setPeerOutFeeStats] = useState(null);
    const [peerFeeSeries, setPeerFeeSeries] = useState({ incoming: [], outgoing: [] });
    const [inboundZoom, setInboundZoom] = useState(null);
    const [outboundZoom, setOutboundZoom] = useState(null);
    const [peerFeeLoading, setPeerFeeLoading] = useState(false);
    const [peerFeeError, setPeerFeeError] = useState(null);

    // Props Advisor Modal State
    const [propsLoading, setPropsLoading] = useState(false);
    const [propsRecommendation, setPropsRecommendation] = useState(null);
    const [propsError, setPropsError] = useState(null);
    const [showPayload, setShowPayload] = useState(false);
    const [lastTelemetry, setLastTelemetry] = useState(null);
    const [verifyResult, setVerifyResult] = useState(null);
    const [analysisMode, setAnalysisMode] = useState(() => (PHALA_UI_CONFIG.available && mockSnapshot ? 'phala_verified' : 'standard'));
    const [phalaRun, setPhalaRun] = useState(null);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [nodePubkey, setNodePubkey] = useState(null);
    const [peers, setPeers] = useState([]);
    const [missionControl, setMissionControl] = useState(null);
    const [geminiAnalysis, setGeminiAnalysis] = useState(null);
    const [geminiLoading, setGeminiLoading] = useState(false);

    // Filter & Pipeline State
    const [showPipeline, setShowPipeline] = useState(false);
    const [pipelineData, setPipelineData] = useState({
        rawMetadata: null,
        normalizedMetadata: null,
        propsPayload: null,
        outgoingInspector: null,
    });
    const [modalConfig, setModalConfig] = useState({
        isOpen: false,
        title: '',
        data: null
    });

    useEffect(() => {
        if (!isMockMode) return;

        const snapshotChannels = Array.isArray(mockSnapshot?.channels) ? mockSnapshot.channels : [];
        const snapshotPeers = Array.isArray(mockSnapshot?.peers) ? mockSnapshot.peers : [];
        const nodeIdentity = String(mockSnapshot?.nodeInfo?.identityPubkey || mockSnapshot?.nodeInfo?.identity_pubkey || '').toLowerCase();

        setNodeInfo(mockSnapshot?.nodeInfo || null);
        setNodePubkey(mockSnapshot?.nodeInfo?.identityPubkey || mockSnapshot?.nodeInfo?.identity_pubkey || null);
        setForwards(Array.isArray(mockSnapshot?.forwardingHistory) ? mockSnapshot.forwardingHistory : []);
        setPeers(snapshotPeers);
        setMissionControl({ pairs: [] });
        setPeerFeeError(null);

        const aliasMap = snapshotChannels.reduce((acc, channel, index) => {
            const channelId = String(channel.chanId || channel.chan_id || '');
            const remotePubkey = String(channel.remotePubkey || channel.remote_pubkey || '');
            const peer = snapshotPeers.find((item) => String(item.pubKey || item.pub_key || item.pubkey || '').toLowerCase() === remotePubkey.toLowerCase());
            acc[channelId] = {
                remotePubkey,
                alias: peer?.alias || `mock-peer-${index + 1}`,
            };
            return acc;
        }, {});

        setChanAliasMap(aliasMap);
        setChanInfoMap(buildMockChannelInfoMap(mockSnapshot));

        const peerPolicies = (Array.isArray(mockSnapshot?.feePolicies) ? mockSnapshot.feePolicies : []).filter((policy) =>
            String(policy.directionPubKey || policy.direction_pub_key || '').toLowerCase() !== nodeIdentity
        );
        const peerFeeValues = peerPolicies
            .map((policy) => Number(policy.feeRatePpm ?? policy.fee_rate_ppm ?? policy.feeRateMilliMsat ?? policy.fee_rate_milli_msat ?? 0))
            .filter((value) => Number.isFinite(value));

        const mockStats = peerFeeValues.length
            ? {
                avg: peerFeeValues.reduce((sum, value) => sum + value, 0) / peerFeeValues.length,
                std: 0,
                min: Math.min(...peerFeeValues),
                max: Math.max(...peerFeeValues),
                median: [...peerFeeValues].sort((a, b) => a - b)[Math.floor(peerFeeValues.length / 2)],
                correctedAvg: peerFeeValues.reduce((sum, value) => sum + value, 0) / peerFeeValues.length,
                weightedAvg: peerFeeValues.reduce((sum, value) => sum + value, 0) / peerFeeValues.length,
            }
            : null;

        setPeerFeeStats(mockStats);
        setPeerOutFeeStats(mockStats);
        setPeerFeeSeries({ incoming: peerFeeValues, outgoing: peerFeeValues });
    }, [isMockMode, mockSnapshot]);

    // 1. Fetch channel aliases
    useEffect(() => {
        if (!lnc?.lnd?.lightning || !nodeChannels.length) return;

        const chanMap = {};
        nodeChannels.forEach((ch) => {
            const id = String(ch.chanId || ch.chan_id || '');
            const pubkey = ch.remotePubkey || ch.remote_pubkey || '';
            if (id && pubkey) chanMap[id] = { remotePubkey: pubkey, alias: '' };
        });

        const uniquePubkeys = [...new Set(Object.values(chanMap).map((v) => v.remotePubkey).filter(Boolean))];

        Promise.allSettled(
            uniquePubkeys.map((pk) =>
                lnc.lnd.lightning
                    .getNodeInfo({ pub_key: pk, include_channels: false })
                    .then((info) => ({ pk, alias: info?.node?.alias || '' }))
                    .catch(() => ({ pk, alias: '' }))
            )
        ).then((results) => {
            const pubkeyAlias = {};
            results.forEach((r) => {
                if (r.status === 'fulfilled') pubkeyAlias[r.value.pk] = r.value.alias;
            });
            Object.values(chanMap).forEach((entry) => {
                entry.alias = pubkeyAlias[entry.remotePubkey] || '';
            });
            setChanAliasMap({ ...chanMap });
        });

        // Fetch channel policies
        const fetchChanInfos = async () => {
            const infoMap = {};
            const promises = nodeChannels.map(async (ch) => {
                const id = String(ch.chanId || ch.chan_id || '');
                if (!id) return;
                try {
                    const info = await lnc.lnd.lightning.getChanInfo({ chan_id: id });
                    infoMap[id] = info;
                } catch (e) {
                    // channel might be closed or not fully gossiped yet
                }
            });
            await Promise.allSettled(promises);
            setChanInfoMap(infoMap);
        };
        fetchChanInfos();

    }, [lnc, nodeChannels]);

    // 2. Fetch forwarding history to calculate generated fees
    useEffect(() => {
        if (!lnc?.lnd?.lightning) return;

        const fetchAllForwards = async () => {
            setIsLoading(true);
            try {
                const response = await lnc.lnd.lightning.forwardingHistory({
                    start_time: '0',
                    end_time: Math.floor(Date.now() / 1000).toString(),
                    num_max_events: 50000,
                });
                const events = Array.isArray(response?.forwardingEvents) ? response.forwardingEvents : [];
                setForwards(events);
            } catch (err) {
                console.error('Failed to fetch forwards for channels page:', err);
                setError(err.message || 'Failed to load forwarding history.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAllForwards();
    }, [lnc]);

    // 3. Fetch peers and mission control for context
    useEffect(() => {
        if (!lnc?.lnd?.lightning) return;

        const fetchContext = async () => {
            try {
                const [pRes, mcRes] = await Promise.all([
                    lnc.lnd.lightning.listPeers({}),
                    lnc.lnd.router ? lnc.lnd.router.queryMissionControl({}) : Promise.resolve({ pairs: [] })
                ]);
                setPeers(Array.isArray(pRes?.peers) ? pRes.peers : []);
                setMissionControl(mcRes);
            } catch (err) {
                console.error('Failed to fetch peers/MC for channels page:', err);
            }
        };

        fetchContext();
    }, [lnc]);

    // 4. Fetch local node info to get identity pubkey (required for suggested fees)
    useEffect(() => {
        if (!lnc?.lnd?.lightning) return;
        const fetchNodeInfo = async () => {
            try {
                const info = await lnc.lnd.lightning.getInfo({});
                setNodeInfo(info);
                setNodePubkey(info.identity_pubkey || info.identityPubkey);
            } catch (err) {
                console.error('Failed to fetch local node info:', err);
            }
        };
        fetchNodeInfo();
    }, [lnc]);

    // 3. Compute stats per channel
    // We separate fees generated when this channel was the INCOMING leg vs OUTGOING leg
    const channelStats = useMemo(() => {
        const stats = new Map(); // chanId => { feeOutSats: 0, feeOutMsat: 0, feeInSats: 0, feeInMsat: 0, fwdsOut: 0, fwdsIn: 0 }

        forwards.forEach(f => {
            const chanIn = String(f.chan_id_in || f.chanIdIn || '');
            const chanOut = String(f.chan_id_out || f.chanIdOut || '');
            const feeSats = Number(f.fee || 0);
            const feeMsat = Number(f.fee_msat || f.feeMsat || 0);

            if (!stats.has(chanIn)) stats.set(chanIn, { feeOutSats: 0, feeOutMsat: 0, feeInSats: 0, feeInMsat: 0, fwdsOut: 0, fwdsIn: 0 });
            if (!stats.has(chanOut)) stats.set(chanOut, { feeOutSats: 0, feeOutMsat: 0, feeInSats: 0, feeInMsat: 0, fwdsOut: 0, fwdsIn: 0 });

            const inStats = stats.get(chanIn);
            inStats.fwdsIn++;
            // When a route comes IN through this channel, it *earns* the routing fee for the node
            // (technically the fee is charged on the OUTGOING channel, but we attribute it to both for analysis if desired,
            // however standard LND accounting attributes the fee earned to the OUTGOING channel policy).
            inStats.feeInSats += feeSats;
            inStats.feeInMsat += feeMsat;

            const outStats = stats.get(chanOut);
            outStats.fwdsOut++;
            outStats.feeOutSats += feeSats;
            outStats.feeOutMsat += feeMsat;
        });

        return stats;
    }, [forwards]);

    const chanLabel = (chanId) => {
        const entry = chanAliasMap[String(chanId)];
        if (entry?.alias) return entry.alias;
        return shortChan(chanId);
    };

    const getFeeRatePpm = (pol) => {
        if (!pol) return null;
        const raw =
            pol.feeRateMilliMsat !== undefined ? pol.feeRateMilliMsat :
                pol.fee_rate_milli_msat !== undefined ? pol.fee_rate_milli_msat :
                    null;
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    };

    const computeStats = (values, weights = []) => {
        const pairs = values
            .map((v, i) => ({ v: Number(v), w: Number(weights[i]) }))
            .filter((p) => Number.isFinite(p.v));
        if (pairs.length === 0) return null;

        const nums = pairs.map((p) => p.v);
        const sorted = [...nums].sort((a, b) => a - b);
        const n = sorted.length;
        const sum = nums.reduce((s, v) => s + v, 0);
        const avg = sum / n;
        const variance = nums.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / n;
        const std = Math.sqrt(variance);
        const min = sorted[0];
        const max = sorted[n - 1];
        const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

        const correctedValues = nums.filter((v) => v > 0);
        const correctedAvg = correctedValues.length
            ? correctedValues.reduce((s, v) => s + v, 0) / correctedValues.length
            : avg;

        const weightedPairs = pairs.filter((p) => Number.isFinite(p.w) && p.w > 0);
        const weightedSum = weightedPairs.reduce((s, p) => s + p.v * p.w, 0);
        const totalWeight = weightedPairs.reduce((s, p) => s + p.w, 0);
        const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : avg;

        return { avg, std, min, max, median, correctedAvg, weightedAvg };
    };

    useEffect(() => {
        if (!feeModalOpen || !selectedChannel?.peerPubkey || !lnc?.lnd?.lightning) return;
        let isMounted = true;
        const fetchPeerFees = async () => {
            setPeerFeeLoading(true);
            setPeerFeeError(null);
            try {
                const info = await lnc.lnd.lightning.getNodeInfo({
                    pub_key: selectedChannel.peerPubkey,
                    include_channels: true,
                });

                const channels = info?.channels || info?.node?.channels || [];
                const peerKey = selectedChannel.peerPubkey.toLowerCase();
                const incomingFees = [];
                const incomingWeights = [];
                const outgoingFees = [];
                const outgoingWeights = [];

                channels.forEach((ch) => {
                    const n1 = String(ch.node1_pub || ch.node1Pub || '').toLowerCase();
                    const n2 = String(ch.node2_pub || ch.node2Pub || '').toLowerCase();
                    const n1pol = ch.node1_policy || ch.node1Policy;
                    const n2pol = ch.node2_policy || ch.node2Policy;
                    const cap = Number(ch.capacity || 0);

                    if (n1 === peerKey) {
                        const fee = getFeeRatePpm(n2pol);
                        if (fee !== null) {
                            incomingFees.push(fee);
                            incomingWeights.push(cap);
                        }
                        const outFee = getFeeRatePpm(n1pol);
                        if (outFee !== null) {
                            outgoingFees.push(outFee);
                            outgoingWeights.push(cap);
                        }
                    } else if (n2 === peerKey) {
                        const fee = getFeeRatePpm(n1pol);
                        if (fee !== null) {
                            incomingFees.push(fee);
                            incomingWeights.push(cap);
                        }
                        const outFee = getFeeRatePpm(n2pol);
                        if (outFee !== null) {
                            outgoingFees.push(outFee);
                            outgoingWeights.push(cap);
                        }
                    }
                });

                const statsIn = computeStats(incomingFees, incomingWeights);
                const statsOut = computeStats(outgoingFees, outgoingWeights);
                if (isMounted) {
                    setPeerFeeStats(statsIn);
                    setPeerOutFeeStats(statsOut);
                    setPeerFeeSeries({ incoming: incomingFees, outgoing: outgoingFees });
                }
            } catch (e) {
                if (isMounted) setPeerFeeError(e?.message || 'Failed to load peer network fee data.');
            } finally {
                if (isMounted) setPeerFeeLoading(false);
            }
        };

        fetchPeerFees();
        return () => {
            isMounted = false;
        };
    }, [feeModalOpen, selectedChannel, lnc]);

    const phalaModeEnabled = PHALA_UI_CONFIG.enabled;
    const phalaModeAvailable = PHALA_UI_CONFIG.available;
    const activeAnalysisMode = isMockMode && phalaModeAvailable
        ? 'phala_verified'
        : (phalaModeAvailable && analysisMode === 'phala_verified' ? 'phala_verified' : 'standard');

    const extractFeeRecommendation = (response) => {
        const feeRecommendations =
            response?.recommendation?.feeRecommendations ||
            response?.recommendationSet?.feeRecommendations ||
            [];

        if (!Array.isArray(feeRecommendations) || feeRecommendations.length === 0) {
            return null;
        }

        return feeRecommendations.find((item) => item.channelRef === 'channel_0001' || item.channelId === selectedChannel?.chanId)
            || feeRecommendations[0];
    };

    const buildOutgoingInspector = ({
        mode,
        propsPayload,
        phalaTelemetry,
        standardResponse = null,
        phalaResponse = null,
        networkInAvgPpm = null,
        networkOutAvgPpm = null,
    }) => {
        if (mode === 'phala_verified') {
            const baseUrl = getPhalaTransportBaseUrl();
            const recommendBody = { telemetry: phalaTelemetry };
            const requests = [
                {
                    label: 'Recommend',
                    method: 'POST',
                    endpoint: `${baseUrl}/api/recommend?full=true`,
                    bodyBytes: jsonByteLength(recommendBody),
                    body: recommendBody,
                },
                { label: 'Health', method: 'GET', endpoint: `${baseUrl}/health` },
                { label: 'Info', method: 'GET', endpoint: `${baseUrl}/info?full=true` },
                { label: 'Attestation', method: 'GET', endpoint: `${baseUrl}/attestation?full=true` },
            ];

            if (phalaResponse?.recommend && phalaResponse?.info && phalaResponse?.attestation) {
                const verifyBody = {
                    transformedSnapshot: phalaResponse.recommend?.transformedSnapshot,
                    recommendationSet: phalaResponse.recommend?.recommendationSet,
                    arb: phalaResponse.recommend?.arb,
                    sourceReceipt: phalaResponse.recommend?.sourceReceipt,
                    liveAppInfo: phalaResponse.info,
                    liveAppAttestation: phalaResponse.attestation,
                };
                requests.push({
                    label: 'Verify',
                    method: 'POST',
                    endpoint: `${baseUrl}/api/verify`,
                    bodyBytes: jsonByteLength(verifyBody),
                    body: verifyBody,
                });
            }

            return {
                route: 'Verified Phala',
                transport: import.meta.env.DEV ? 'Browser -> localhost Vite proxy -> Phala app' : 'Browser -> Phala app',
                destination: baseUrl,
                requests,
            };
        }

        const baseUrl = getStandardApiBaseUrl();
        const recommendBody = {
            propsPayload,
            peerFeeContext: {
                networkInAvgPpm,
                networkOutAvgPpm,
            },
            privacyMode: 'feature_only',
        };
        const requests = [
            {
                label: 'Recommend',
                method: 'POST',
                endpoint: `${baseUrl}/api/recommend/fee-suggestions`,
                bodyBytes: jsonByteLength(recommendBody),
                body: recommendBody,
            },
        ];

        if (standardResponse?.arb) {
            const verifyBody = {
                arb: standardResponse.arb,
                ...(standardResponse.sourceProvenance ? { sourceProvenance: standardResponse.sourceProvenance } : {}),
            };
            requests.push({
                label: 'Verify',
                method: 'POST',
                endpoint: `${baseUrl}/api/verify`,
                bodyBytes: jsonByteLength(verifyBody),
                body: verifyBody,
            });
        }

        return {
            route: 'Standard API',
            transport: 'Browser -> local API server',
            destination: baseUrl,
            requests,
        };
    };

    const buildSelectedChannelAnalysisInputs = () => {
        const selectedChannelId = String(selectedChannel?.chanId || '');
        const currentChannelStats = channelStats.get(selectedChannelId) || {
            feeOutSats: 0,
            fwdsOut: 0,
        };

        const rawTelemetry = {
            nodeInfo,
            forwardingHistory: forwards,
            feePolicies: [{
                channelId: selectedChannel.chanId,
                feeRatePpm: getFeeRatePpm(selectedChannel.myPolicy)
            }],
            missionControl,
        };

        const rawSnapshot = {
            stage: 'raw_lnd_extraction',
            collectedAt: new Date().toISOString(),
            nodeAlias: nodeInfo?.alias || 'unknown-node',
            channelId: selectedChannel.chanId,
            peerPubkey: selectedChannel.peerPubkey,
            _raw: {
                node: nodeInfo,
                channel: selectedChannel,
                peers: peers.filter((p) => (p.pub_key || p.pubKey) === selectedChannel.peerPubkey),
                missionControlCount: rawTelemetry.missionControl?.pairs?.length || 0
            }
        };

        const normalizedSnapshot = normalizeSnapshot({
            nodeInfo: rawTelemetry.nodeInfo,
            channels: [{
                chanId: selectedChannel.chanId,
                remotePubkey: selectedChannel.peerPubkey,
                capacity: selectedChannel.capacity,
                localBalance: selectedChannel.local,
                remoteBalance: selectedChannel.remote,
                active: true,
                networkInAvg: peerFeeStats?.correctedAvg ?? null,
                networkOutAvg: peerOutFeeStats?.correctedAvg ?? null
            }],
            peers,
            forwardingHistory: rawTelemetry.forwardingHistory,
            routingFailures: [],
            feePolicies: rawTelemetry.feePolicies,
            graphNodes: [],
            graphEdges: [],
            nodeCentralityMetrics: [],
            missionControlPairs: rawTelemetry.missionControl?.pairs || [],
            collectedAt: new Date().toISOString()
        });

        const propsSnapshot = applyPrivacyPolicy(normalizedSnapshot, 'feature_only');
        const phalaTelemetry = {
            nodeAlias: nodeInfo?.alias || nodeInfo?.identity_pubkey || 'tapvolt-node',
            channels: [{
                channelId: selectedChannel.chanId,
                peerPubkey: selectedChannel.peerPubkey,
                active: selectedChannel?.active !== false,
                localBalanceSat: Number(selectedChannel?.local || selectedChannel?.localBalance || selectedChannel?.local_balance || 0),
                remoteBalanceSat: Number(selectedChannel?.remote || selectedChannel?.remoteBalance || selectedChannel?.remote_balance || 0),
                outboundFeePpm: getFeeRatePpm(selectedChannel.myPolicy) ?? 0,
                forwardCount: Number(currentChannelStats?.fwdsOut || 0),
                revenueSat: Number(currentChannelStats?.feeOutSats || 0),
                failedForwardCount: 0,
            }],
        };

        return {
            rawTelemetry,
            rawSnapshot,
            normalizedSnapshot,
            propsSnapshot,
            phalaTelemetry,
        };
    };

    const handleRunChannelAnalysis = async () => {
        if (!lnc?.lnd?.lightning && !isMockMode) {
            setPropsError('Lightning connection or mock lightning mode is required before running the Props pipeline.');
            return;
        }

        if (!selectedChannel) {
            setPropsError('Select a channel before running analysis.');
            return;
        }

        try {
            setPropsLoading(true);
            setPropsError(null);
            setError(null);
            setPropsRecommendation(null);
            setVerifyResult(null);
            setGeminiAnalysis(null);
            setGeminiLoading(false);
            setPhalaRun(null);

            const {
                rawTelemetry,
                rawSnapshot,
                normalizedSnapshot,
                propsSnapshot,
                phalaTelemetry,
            } = buildSelectedChannelAnalysisInputs();

            setLastTelemetry(rawTelemetry);
            setPipelineData({
                rawMetadata: rawSnapshot,
                normalizedMetadata: normalizedSnapshot,
                propsPayload: propsSnapshot,
                outgoingInspector: buildOutgoingInspector({
                    mode: activeAnalysisMode,
                    propsPayload: propsSnapshot,
                    phalaTelemetry,
                    networkInAvgPpm: peerFeeStats?.correctedAvg ?? null,
                    networkOutAvgPpm: peerOutFeeStats?.correctedAvg ?? null,
                }),
            });

            console.info('Props Advisor route selection', {
                isMockMode,
                phalaModeEnabled,
                phalaModeAvailable,
                requestedAnalysisMode: analysisMode,
                activeAnalysisMode,
                phalaAppUrl: PHALA_UI_CONFIG.appUrl,
            });

            if (activeAnalysisMode === 'phala_verified') {
                const phalaResponse = await runPhalaVerifiedRecommendation(phalaTelemetry);
                const recommendation = extractFeeRecommendation(phalaResponse.recommend);

                if (!recommendation) {
                    throw new Error('Phala verified path returned no fee recommendation for the selected channel.');
                }

                setPropsRecommendation(recommendation);
                setVerifyResult(phalaResponse.verify);
                setPhalaRun(phalaResponse);
                setPipelineData((previous) => ({
                    ...previous,
                    outgoingInspector: buildOutgoingInspector({
                        mode: activeAnalysisMode,
                        propsPayload: propsSnapshot,
                        phalaTelemetry,
                        phalaResponse,
                        networkInAvgPpm: peerFeeStats?.correctedAvg ?? null,
                        networkOutAvgPpm: peerOutFeeStats?.correctedAvg ?? null,
                    }),
                }));
                return;
            }

            const res = await postFeeSuggestion({
                propsPayload: propsSnapshot,
                peerFeeContext: {
                    networkInAvgPpm: peerFeeStats?.correctedAvg ?? null,
                    networkOutAvgPpm: peerOutFeeStats?.correctedAvg ?? null,
                },
                privacyMode: 'feature_only',
            });

            const recommendation = extractFeeRecommendation(res);
            if (!recommendation) {
                throw new Error('Props API returned no fee recommendation for the selected channel.');
            }

            setPropsRecommendation(recommendation);
            setPipelineData((previous) => ({
                ...previous,
                outgoingInspector: buildOutgoingInspector({
                    mode: activeAnalysisMode,
                    propsPayload: propsSnapshot,
                    phalaTelemetry,
                    standardResponse: res,
                    networkInAvgPpm: peerFeeStats?.correctedAvg ?? null,
                    networkOutAvgPpm: peerOutFeeStats?.correctedAvg ?? null,
                }),
            }));

            try {
                const vRes = await postVerify(res.arb, res.sourceProvenance);
                setVerifyResult(vRes);
            } catch (vErr) {
                console.warn('ARB Verification failed:', vErr);
                setVerifyResult({ ok: false, error: vErr.message });
            }
        } catch (err) {
            console.error('Props pipeline failed:', err);
            setPropsRecommendation(null);
            setVerifyResult(null);
            setPhalaRun(null);
            setPropsError(err?.message || 'Props pipeline failed.');
        } finally {
            setPropsLoading(false);
        }
    };

    const handleCloseFeeModal = () => {
        setFeeModalOpen(false);
        setGeminiAnalysis(null);
        setGeminiLoading(false);
        setPhalaRun(null);
    };

    // ── Shared styles ──────────────────────────────────────────────────────────
    const cardStyle = {
        backgroundColor: 'var(--bg-card)',
        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
        boxShadow: darkMode ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.05)',
    };

    const thStyle = {
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-secondary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
        whiteSpace: 'nowrap',
    };

    const tdStyle = {
        padding: '12px 16px',
        fontSize: 13,
        color: 'var(--text-primary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
        whiteSpace: 'nowrap',
    };

    const totalCapacity = nodeChannels.reduce((sum, ch) => sum + Number(ch.capacity || 0), 0);
    const totalLocal = nodeChannels.reduce((sum, ch) => sum + Number(ch.localBalance || ch.local_balance || 0), 0);
    const totalRemote = nodeChannels.reduce((sum, ch) => sum + Number(ch.remoteBalance || ch.remote_balance || 0), 0);
    const totalFeesSats = Array.from(channelStats.values()).reduce((sum, s) => sum + s.feeOutSats, 0);
    const totalFeesMsat = Array.from(channelStats.values()).reduce((sum, s) => sum + s.feeOutMsat, 0);

    return (
        <div className="p-6 space-y-8" style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    Channel Management
                </h2>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {nodeChannels.length} active channels
                </div>

            </div>

            {error && (
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-text)' }}>
                    {error}
                </div>
            )}

            {/* Overall Balances Bar */}
            <div className="rounded-xl p-6 transition-colors duration-300" style={cardStyle}>
                <div className="flex justify-between items-end mb-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-1">Local / Outbound</p>
                        <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totalLocal.toLocaleString()} <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>sats</span></p>
                    </div>
                    <div className="text-center">
                        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-1">Total Capacity</p>
                        <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totalCapacity.toLocaleString()} <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>sats</span></p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-widest text-amber-500 mb-1">Remote / Inbound</p>
                        <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{totalRemote.toLocaleString()} <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>sats</span></p>
                    </div>
                </div>

                {totalCapacity > 0 && (
                    <div className="w-full h-4 rounded-full overflow-hidden flex" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                        <div style={{ width: `${(totalLocal / totalCapacity) * 100}%`, backgroundColor: '#10b981' }} title={`Local: ${(totalLocal / totalCapacity * 100).toFixed(1)}%`} />
                        <div style={{ width: `${(totalRemote / totalCapacity) * 100}%`, backgroundColor: '#f59e0b' }} title={`Remote: ${(totalRemote / totalCapacity * 100).toFixed(1)}%`} />
                    </div>
                )}

                <div className="mt-4 pt-4 border-t flex justify-between items-center" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Routing Fees Earned:</span>
                    <div className="text-right">
                        <span className="font-bold text-emerald-500">{totalFeesSats.toLocaleString()} sats</span>
                        <span className="text-xs ml-2 text-emerald-500/70">({totalFeesMsat.toLocaleString()} msat)</span>
                    </div>
                </div>
            </div>

            {/* Channels Table */}
            <div className="rounded-xl overflow-hidden transition-colors duration-300" style={cardStyle}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                    <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Channel List</h3>
                    {isLoading && <span className="text-xs animate-pulse text-indigo-500">Updating stats...</span>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Peer / Channel ID</th>
                                <th style={{ ...thStyle, width: '25%' }}>Liquidity (Local 🟩 / Remote 🟧)</th>
                                <th style={thStyle}>Current Policy (Fee Rate)</th>
                                <th style={thStyle}>Historical Routing Fees</th>
                            </tr>
                        </thead>
                        <tbody>
                            {nodeChannels.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                                        No active channels found.
                                    </td>
                                </tr>
                            ) : (
                                nodeChannels.map((ch, i) => {
                                    const chanId = String(ch.chanId || ch.chan_id || '');
                                    const active = ch.active;
                                    const capacity = Number(ch.capacity || 0);
                                    const local = Number(ch.localBalance || ch.local_balance || 0);
                                    const remote = Number(ch.remoteBalance || ch.remote_balance || 0);
                                    const localPct = capacity > 0 ? (local / capacity) * 100 : 0;
                                    const remotePct = capacity > 0 ? (remote / capacity) * 100 : 0;

                                    const stats = channelStats.get(chanId) || { feeOutSats: 0, feeOutMsat: 0, feeInSats: 0, feeInMsat: 0 };

                                    // Extract policies (handle camelCase or snake_case from LNC)
                                    const cInfo = chanInfoMap[chanId];
                                    let myPolicy = null;
                                    let peerPolicy = null;
                                    if (cInfo) {
                                        const n1pub = String(cInfo.node1_pub || cInfo.node1Pub || '').toLowerCase();
                                        const n1pol = cInfo.node1_policy || cInfo.node1Policy;
                                        const n2pol = cInfo.node2_policy || cInfo.node2Policy;
                                        const peerPub = String(ch.remotePubkey || ch.remote_pubkey || '').toLowerCase();

                                        if (n1pub === peerPub) {
                                            myPolicy = n2pol; // We are node2, peer is node1
                                            peerPolicy = n1pol;
                                        } else {
                                            myPolicy = n1pol; // We are node1, peer is node2
                                            peerPolicy = n2pol;
                                        }
                                    }

                                    const getFeeRate = (pol) => {
                                        if (!pol) return null;
                                        if (pol.feeRateMilliMsat !== undefined) return pol.feeRateMilliMsat;
                                        if (pol.fee_rate_milli_msat !== undefined) return pol.fee_rate_milli_msat;
                                        return '0';
                                    };

                                    const myFeeRate = getFeeRate(myPolicy);
                                    const peerFeeRate = getFeeRate(peerPolicy);

                                    return (
                                        <tr
                                            key={chanId}
                                            style={{ backgroundColor: i % 2 === 0 ? 'transparent' : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}
                                            className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => {
                                                setSelectedChannel({
                                                    chanId,
                                                    alias: chanLabel(chanId),
                                                    peerPubkey: String(ch.remotePubkey || ch.remote_pubkey || ''),
                                                    myPolicy,
                                                    peerPolicy,
                                                    capacity,
                                                    local,
                                                    remote,
                                                    stats
                                                });
                                                setFeeModalOpen(true);
                                                setPropsRecommendation(null);
                                                setPropsError(null);
                                                setShowPayload(false);
                                                setLastTelemetry(null);
                                                setGeminiAnalysis(null);
                                                setGeminiLoading(false);
                                            }}
                                        >
                                            <td style={tdStyle}>
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                    <span className="text-xs font-semibold">{active ? 'Active' : 'Offline'}</span>
                                                </div>
                                            </td>
                                            <td style={tdStyle} title={chanId}>
                                                <div className="font-bold text-indigo-400">{chanLabel(chanId)}</div>
                                                <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{shortChan(chanId)}</div>
                                            </td>
                                            <td style={tdStyle}>
                                                <div className="flex flex-col gap-1 w-full max-w-xs">
                                                    <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                                                        <span>{fmtSats(local)}</span>
                                                        <span>{fmtSats(remote)}</span>
                                                    </div>
                                                    <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                                                        <div style={{ width: `${localPct}%`, backgroundColor: '#10b981' }} />
                                                        <div style={{ width: `${remotePct}%`, backgroundColor: '#f59e0b' }} />
                                                    </div>
                                                    <div className="text-[10px] text-center mt-0.5 text-gray-500">{fmtSats(capacity)} cap</div>
                                                </div>
                                            </td>
                                            <td style={tdStyle}>
                                                <div className="flex flex-col gap-1 text-xs">
                                                    <div className="flex justify-between items-center gap-4">
                                                        <span className="text-emerald-500 font-semibold" title="Fee you charge for routing OUT of this channel">Outbound:</span>
                                                        <span className="font-mono">{myFeeRate !== null ? `${myFeeRate} ppm` : '—'}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center gap-4">
                                                        <span className="text-fuchsia-500 font-semibold" title="Fee peer charges for routing IN to this channel">Inbound:</span>
                                                        <span className="font-mono">{peerFeeRate !== null ? `${peerFeeRate} ppm` : '—'}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={tdStyle}>
                                                <div className="flex flex-col gap-1 text-xs text-right font-mono">
                                                    <div className="flex justify-end items-center gap-2">
                                                        <span className="text-emerald-500/70 text-[10px] uppercase">Out:</span>
                                                        <span className="text-emerald-500 font-bold">{stats.feeOutSats > 0 ? `+${fmtSats(stats.feeOutSats)}` : '0'}</span>
                                                        <span className="text-emerald-500/70 text-[10px] min-w-[60px]">{stats.feeOutMsat > 0 ? `${stats.feeOutMsat} msat` : '0 msat'}</span>
                                                    </div>
                                                    <div className="flex justify-end items-center gap-2">
                                                        <span className="text-fuchsia-500/70 text-[10px] uppercase">In:</span>
                                                        <span className="text-fuchsia-400 font-bold">{stats.feeInSats > 0 ? `+${fmtSats(stats.feeInSats)}` : '0'}</span>
                                                        <span className="text-fuchsia-400/70 text-[10px] min-w-[60px]">{stats.feeInMsat > 0 ? `${stats.feeInMsat} msat` : '0 msat'}</span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {feeModalOpen && selectedChannel && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all duration-300 p-4"
                    onClick={handleCloseFeeModal}
                >
                    <div
                        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl p-8 shadow-2xl transform transition-transform duration-300 scale-100"
                        style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-6">
                            <div>
                                <p className="text-xs uppercase tracking-widest text-indigo-400">Fee Report</p>
                                <h3 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                                    {selectedChannel.alias}
                                </h3>
                                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    Channel {shortChan(selectedChannel.chanId)} · Peer {shortChan(selectedChannel.peerPubkey)}
                                </p>
                            </div>
                            <button
                                onClick={handleCloseFeeModal}
                                className="p-2 rounded-full transition-colors duration-200"
                                style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)' }}
                                aria-label="Close modal"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                            <div className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Current Fees Snapshot</div>
                            <div
                                className="text-xs font-semibold px-2 py-1 rounded-full"
                                style={{
                                    color: darkMode ? '#c7d2fe' : '#3730a3',
                                    backgroundColor: darkMode ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.12)',
                                }}
                            >
                                Live channel policies
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div
                                className="rounded-xl p-4 border"
                                style={{
                                    backgroundColor: darkMode ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)',
                                    borderColor: darkMode ? 'rgba(16,185,129,0.35)' : 'rgba(5,150,105,0.35)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs uppercase tracking-widest text-emerald-400">Peer Fee To You</p>
                                    <span
                                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                        style={{
                                            color: darkMode ? '#a7f3d0' : '#065f46',
                                            backgroundColor: darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.12)',
                                        }}
                                    >
                                        Incoming
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    {(() => {
                                        const peerFee = getFeeRatePpm(selectedChannel.peerPolicy);
                                        const stats = peerOutFeeStats;
                                        return (
                                            <>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Corrected Avg</div>
                                                    <div className="text-lg font-bold" style={{ color: darkMode ? '#34d399' : '#047857' }}>
                                                        {stats ? stats.correctedAvg.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Weighted Avg</div>
                                                    <div className="text-lg font-bold" style={{ color: darkMode ? '#34d399' : '#047857' }}>
                                                        {stats ? stats.weightedAvg.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Average</div>
                                                    <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {stats ? stats.avg.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Std Dev</div>
                                                    <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {stats ? stats.std.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Min</div>
                                                    <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {stats ? stats.min.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Max</div>
                                                    <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {stats ? stats.max.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Median</div>
                                                    <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {stats ? stats.median.toFixed(0) : '—'} ppm
                                                    </div>
                                                </div>
                                                <div
                                                    className="rounded-lg p-2"
                                                    style={{ backgroundColor: darkMode ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.12)' }}
                                                >
                                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Peer Fee To You</div>
                                                    <div className="text-base font-semibold" style={{ color: darkMode ? '#a7f3d0' : '#065f46' }}>
                                                        {peerFee !== null ? `${peerFee.toFixed(0)} ppm` : '—'}
                                                    </div>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div
                                className="rounded-xl p-4 border"
                                style={{
                                    backgroundColor: darkMode ? 'rgba(217,70,239,0.08)' : 'rgba(217,70,239,0.06)',
                                    borderColor: darkMode ? 'rgba(217,70,239,0.35)' : 'rgba(192,38,211,0.35)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs uppercase tracking-widest text-fuchsia-400">Fees Other Peers Set To It</p>
                                    <span
                                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                        style={{
                                            color: darkMode ? '#f5d0fe' : '#701a75',
                                            backgroundColor: darkMode ? 'rgba(217,70,239,0.2)' : 'rgba(217,70,239,0.12)',
                                        }}
                                    >
                                        Outgoing
                                    </span>
                                </div>
                                {peerFeeLoading ? (
                                    <div className="text-sm animate-pulse text-indigo-400">Loading peer network fees...</div>
                                ) : peerFeeError ? (
                                    <div className="text-sm" style={{ color: 'var(--error-text)' }}>{peerFeeError}</div>
                                ) : peerFeeStats ? (
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Corrected Avg</div>
                                            <div className="text-lg font-bold" style={{ color: darkMode ? '#e879f9' : '#a21caf' }}>
                                                {peerFeeStats.correctedAvg.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Weighted Avg</div>
                                            <div className="text-lg font-bold" style={{ color: darkMode ? '#e879f9' : '#a21caf' }}>
                                                {peerFeeStats.weightedAvg.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Average</div>
                                            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {peerFeeStats.avg.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Std Dev</div>
                                            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {peerFeeStats.std.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Min</div>
                                            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {peerFeeStats.min.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Max</div>
                                            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {peerFeeStats.max.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Median</div>
                                            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {peerFeeStats.median.toFixed(0)} ppm
                                            </div>
                                        </div>
                                        <div
                                            className="rounded-lg p-2"
                                            style={{ backgroundColor: darkMode ? 'rgba(217,70,239,0.16)' : 'rgba(217,70,239,0.12)' }}
                                        >
                                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Your Fee To Peer</div>
                                            <div className="text-base font-semibold" style={{ color: darkMode ? '#f5d0fe' : '#701a75' }}>
                                                {Number.isFinite(getFeeRatePpm(selectedChannel.myPolicy))
                                                    ? `${getFeeRatePpm(selectedChannel.myPolicy).toFixed(0)} ppm`
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No peer network fee data available.</div>
                                )}
                            </div>
                        </div>

                        <div className="mt-6 grid grid-cols-1 gap-6">
                            {(() => {
                                const getNiceStep = (raw) => {
                                    if (!Number.isFinite(raw) || raw <= 0) return 10;
                                    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
                                    const scaled = raw / pow;
                                    const nice =
                                        scaled <= 1 ? 1 :
                                            scaled <= 2 ? 2 :
                                                scaled <= 5 ? 5 : 10;
                                    return nice * pow;
                                };

                                const buildHistogram = (values, rangeParam) => {
                                    const clean = values
                                        .map((v) => Number(v))
                                        .filter((v) => Number.isFinite(v));
                                    if (!clean.length) return { bins: [], maxCount: 0, total: 0 };
                                    const filtered = rangeParam
                                        ? clean.filter((v) => v >= rangeParam.min && v < rangeParam.max)
                                        : clean;
                                    if (!filtered.length) return { bins: [], maxCount: 0, total: clean.length, binSize: 0, range: rangeParam };
                                    const maxVal = Math.max(...filtered, 0);
                                    const minVal = Math.min(...filtered, 0);
                                    const rangeSpan = Math.max(maxVal - minVal, 1);
                                    const targetBins = 18;
                                    const binSize = getNiceStep(rangeSpan / targetBins);
                                    const start = rangeParam ? rangeParam.min : 0;
                                    const binCount = Math.max(1, Math.ceil((maxVal - start) / binSize));
                                    const bins = Array.from({ length: binCount }, (_, i) => ({
                                        min: start + i * binSize,
                                        max: start + (i + 1) * binSize,
                                        count: 0,
                                    }));
                                    filtered.forEach((v) => {
                                        const idx = Math.min(Math.floor((v - start) / binSize), bins.length - 1);
                                        bins[idx].count += 1;
                                    });
                                    const nonZeroBins = bins.filter((b) => b.count > 0);
                                    const maxCount = Math.max(...nonZeroBins.map((b) => b.count), 1);
                                    return { bins: nonZeroBins, maxCount, total: clean.length, binSize, range: rangeParam };
                                };

                                const inboundHist = buildHistogram(peerFeeSeries.incoming, inboundZoom);
                                const outboundHist = buildHistogram(peerFeeSeries.outgoing, outboundZoom);
                                const inboundMarker = getFeeRatePpm(selectedChannel.myPolicy);
                                const outboundMarker = getFeeRatePpm(selectedChannel.peerPolicy);
                                const chartHeight = 200;
                                const getTicks = (maxCount) => {
                                    const max = Math.max(maxCount, 1);
                                    const mid = Math.ceil(max / 2);
                                    return [max, mid, 0];
                                };
                                const labelEvery = (bins) => Math.max(1, Math.ceil(bins.length / 6));
                                const getMarkerLeftPct = (marker, bins) => {
                                    if (!Number.isFinite(marker) || !bins.length) return null;
                                    const idx = bins.findIndex((b) => marker >= b.min && marker < b.max);
                                    if (idx === -1) return null;
                                    return ((idx + 0.5) / bins.length) * 100;
                                };

                                return (
                                    <>
                                        <div className="rounded-xl p-4" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}>
                                            <div className="flex items-center justify-between mb-3">
                                                <p className="text-xs uppercase tracking-widest text-fuchsia-400">Inbound Fees To Peer</p>
                                                {inboundZoom && (
                                                    <button
                                                        className="text-[10px] px-2 py-1 rounded-full"
                                                        style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: 'var(--text-secondary)' }}
                                                        onClick={() => setInboundZoom(null)}
                                                    >
                                                        Reset Zoom
                                                    </button>
                                                )}
                                            </div>
                                            {inboundHist.total > 0 ? (
                                                <>
                                                    <div className="flex gap-3">
                                                        <div className="flex flex-col justify-between text-[10px] pr-2" style={{ color: 'var(--text-secondary)' }}>
                                                            {getTicks(inboundHist.maxCount).map((t, idx) => (
                                                                <div key={`in-tick-${t}-${idx}`} className="h-0 leading-none">{t}</div>
                                                            ))}
                                                        </div>
                                                        <div className="relative flex-1">
                                                            <div className="absolute inset-0 pointer-events-none">
                                                                {getTicks(inboundHist.maxCount).map((t, idx) => (
                                                                    <div
                                                                        key={`in-line-${t}-${idx}`}
                                                                        className="absolute left-0 right-0 h-px"
                                                                        style={{
                                                                            top: `${(1 - t / Math.max(inboundHist.maxCount, 1)) * 100}%`,
                                                                            backgroundColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                                                        }}
                                                                    />
                                                                ))}
                                                            </div>
                                                            <div className="relative pb-2" style={{ height: chartHeight, overflowY: 'hidden' }}>
                                                                <div className="absolute left-0 right-0 bottom-0 h-px" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)' }} />
                                                                <div
                                                                    className="relative flex items-end gap-1.5"
                                                                    style={{ height: chartHeight, width: '100%' }}
                                                                >
                                                                    {inboundHist.bins.map((b) => (
                                                                        <div
                                                                            key={`${b.min}-${b.max}`}
                                                                            className="relative group"
                                                                            style={{ flex: 1, minWidth: 0 }}
                                                                            onClick={() => setInboundZoom({ min: b.min, max: b.max })}
                                                                            role="button"
                                                                            title={`Zoom to ${b.min}-${b.max} ppm`}
                                                                        >
                                                                            <div
                                                                                className="rounded-t border"
                                                                                style={{
                                                                                    height: `${(b.count / inboundHist.maxCount) * chartHeight}px`,
                                                                                    backgroundColor: darkMode ? '#f5a7ff' : '#d946ef',
                                                                                    borderColor: darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
                                                                                    minHeight: b.count ? 2 : 0,
                                                                                }}
                                                                            />
                                                                            <div
                                                                                className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 rounded px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', whiteSpace: 'nowrap', zIndex: 2 }}
                                                                            >
                                                                                {b.min}-{b.max} ppm · {b.count}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    {(() => {
                                                                        const left = getMarkerLeftPct(inboundMarker, inboundHist.bins);
                                                                        return left !== null ? (
                                                                            <div
                                                                                className="absolute bottom-0 w-0.5 pointer-events-none"
                                                                                style={{
                                                                                    left: `${left}%`,
                                                                                    height: chartHeight,
                                                                                    backgroundColor: '#f59e0b',
                                                                                    boxShadow: '0 0 6px rgba(245,158,11,0.7)',
                                                                                    zIndex: 1,
                                                                                }}
                                                                                title="Your fee to this peer"
                                                                            />
                                                                        ) : null;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-start gap-1.5 pt-1" style={{ height: 18, overflowY: 'hidden' }}>
                                                                {inboundHist.bins.map((b, i) => (
                                                                    <div key={`in-label-${b.min}`} className="text-[9px] text-center" style={{ flex: 1, minWidth: 0, color: 'var(--text-secondary)' }}>
                                                                        {i % labelEvery(inboundHist.bins) === 0 ? b.min : ''}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between text-[11px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                                                        <span>
                                                            {inboundHist.total} channels · Bin {inboundHist.binSize || 0} ppm
                                                            {inboundZoom ? ` · Zoom ${inboundZoom.min}-${inboundZoom.max}` : ''}
                                                        </span>
                                                        <span>Your Fee {Number.isFinite(inboundMarker) ? `${inboundMarker.toFixed(0)} ppm` : '—'}</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No inbound fee distribution.</div>
                                            )}
                                        </div>

                                        <div className="rounded-xl p-4" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}>
                                            <div className="flex items-center justify-between mb-3">
                                                <p className="text-xs uppercase tracking-widest text-emerald-400">Outbound Fees From Peer</p>
                                                {outboundZoom && (
                                                    <button
                                                        className="text-[10px] px-2 py-1 rounded-full"
                                                        style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: 'var(--text-secondary)' }}
                                                        onClick={() => setOutboundZoom(null)}
                                                    >
                                                        Reset Zoom
                                                    </button>
                                                )}
                                            </div>
                                            {outboundHist.total > 0 ? (
                                                <>
                                                    <div className="flex gap-3">
                                                        <div className="flex flex-col justify-between text-[10px] pr-2" style={{ color: 'var(--text-secondary)' }}>
                                                            {getTicks(outboundHist.maxCount).map((t, idx) => (
                                                                <div key={`out-tick-${t}-${idx}`} className="h-0 leading-none">{t}</div>
                                                            ))}
                                                        </div>
                                                        <div className="relative flex-1">
                                                            <div className="absolute inset-0 pointer-events-none">
                                                                {getTicks(outboundHist.maxCount).map((t, idx) => (
                                                                    <div
                                                                        key={`out-line-${t}-${idx}`}
                                                                        className="absolute left-0 right-0 h-px"
                                                                        style={{
                                                                            top: `${(1 - t / Math.max(outboundHist.maxCount, 1)) * 100}%`,
                                                                            backgroundColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                                                        }}
                                                                    />
                                                                ))}
                                                            </div>
                                                            <div className="relative pb-2" style={{ height: chartHeight, overflowY: 'hidden' }}>
                                                                <div className="absolute left-0 right-0 bottom-0 h-px" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)' }} />
                                                                <div
                                                                    className="relative flex items-end gap-1.5"
                                                                    style={{ height: chartHeight, width: '100%' }}
                                                                >
                                                                    {outboundHist.bins.map((b) => (
                                                                        <div
                                                                            key={`${b.min}-${b.max}`}
                                                                            className="relative group"
                                                                            style={{ flex: 1, minWidth: 0 }}
                                                                            onClick={() => setOutboundZoom({ min: b.min, max: b.max })}
                                                                            role="button"
                                                                            title={`Zoom to ${b.min}-${b.max} ppm`}
                                                                        >
                                                                            <div
                                                                                className="rounded-t border"
                                                                                style={{
                                                                                    height: `${(b.count / outboundHist.maxCount) * chartHeight}px`,
                                                                                    backgroundColor: darkMode ? '#34d399' : '#10b981',
                                                                                    borderColor: darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
                                                                                    minHeight: b.count ? 2 : 0,
                                                                                }}
                                                                            />
                                                                            <div
                                                                                className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 rounded px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', whiteSpace: 'nowrap', zIndex: 2 }}
                                                                            >
                                                                                {b.min}-{b.max} ppm · {b.count}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    {(() => {
                                                                        const left = getMarkerLeftPct(outboundMarker, outboundHist.bins);
                                                                        return left !== null ? (
                                                                            <div
                                                                                className="absolute bottom-0 w-0.5 pointer-events-none"
                                                                                style={{
                                                                                    left: `${left}%`,
                                                                                    height: chartHeight,
                                                                                    backgroundColor: '#f59e0b',
                                                                                    boxShadow: '0 0 6px rgba(245,158,11,0.7)',
                                                                                    zIndex: 1,
                                                                                }}
                                                                                title="Peer fee to you"
                                                                            />
                                                                        ) : null;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-start gap-1.5 pt-1" style={{ height: 18, overflowY: 'hidden' }}>
                                                                {outboundHist.bins.map((b, i) => (
                                                                    <div key={`out-label-${b.min}`} className="text-[9px] text-center" style={{ flex: 1, minWidth: 0, color: 'var(--text-secondary)' }}>
                                                                        {i % labelEvery(outboundHist.bins) === 0 ? b.min : ''}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between text-[11px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                                                        <span>
                                                            {outboundHist.total} channels · Bin {outboundHist.binSize || 0} ppm
                                                            {outboundZoom ? ` · Zoom ${outboundZoom.min}-${outboundZoom.max}` : ''}
                                                        </span>
                                                        <span>Peer Fee {Number.isFinite(outboundMarker) ? `${outboundMarker.toFixed(0)} ppm` : '—'}</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No outbound fee distribution.</div>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        <div
                            className="mt-6 rounded-xl p-4 border"
                            style={{
                                backgroundColor: darkMode ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)',
                                borderColor: darkMode ? 'rgba(99,102,241,0.35)' : 'rgba(79,70,229,0.35)',
                            }}
                        >
                            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                                <p className="text-xs uppercase tracking-widest text-indigo-400">Comparison</p>
                                {(() => {
                                    const outFee = getFeeRatePpm(selectedChannel.myPolicy);
                                    const inFee = getFeeRatePpm(selectedChannel.peerPolicy);
                                    const ratio = outFee && inFee ? (outFee / inFee) : null;
                                    return (
                                        <div
                                            className="text-xs font-semibold px-2 py-1 rounded-full"
                                            style={{
                                                color: darkMode ? '#c7d2fe' : '#3730a3',
                                                backgroundColor: darkMode ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.12)',
                                            }}
                                        >
                                            Out / In Ratio: <span style={{ color: darkMode ? '#a5b4fc' : '#312e81' }}>{ratio ? ratio.toFixed(2) : '—'}x</span>
                                        </div>
                                    );
                                })()}
                            </div>

                            {(() => {
                                const outFee = getFeeRatePpm(selectedChannel.myPolicy) || 0;
                                const inFee = getFeeRatePpm(selectedChannel.peerPolicy) || 0;
                                const networkIn = peerFeeStats?.correctedAvg || 0;
                                const networkOut = peerOutFeeStats?.correctedAvg || 0;
                                const maxOutbound = Math.max(outFee, networkIn, 1);
                                const maxInbound = Math.max(inFee, networkOut, 1);
                                const barStyle = (value, max, color) => ({
                                    width: `${(value / max) * 100}%`,
                                    backgroundColor: color,
                                });
                                return (
                                    <div className="space-y-3 text-xs">
                                        <div>
                                            <div className="flex justify-between mb-1">
                                                <span className="font-semibold" style={{ color: darkMode ? '#34d399' : '#047857' }}>
                                                    Your Fee (Outbound)
                                                </span>
                                                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                    {outFee ? `${outFee.toFixed(0)} ppm` : '—'}
                                                </span>
                                            </div>
                                            <div
                                                className="h-2.5 rounded-full overflow-hidden"
                                                style={{ backgroundColor: darkMode ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.18)' }}
                                            >
                                                <div style={barStyle(outFee, maxOutbound, darkMode ? '#34d399' : '#10b981')} className="h-full" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between mb-1">
                                                <span className="font-semibold" style={{ color: darkMode ? '#e879f9' : '#a21caf' }}>
                                                    Peer Fee To You (Incoming)
                                                </span>
                                                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                    {inFee ? `${inFee.toFixed(0)} ppm` : '—'}
                                                </span>
                                            </div>
                                            <div
                                                className="h-2.5 rounded-full overflow-hidden"
                                                style={{ backgroundColor: darkMode ? 'rgba(217,70,239,0.18)' : 'rgba(217,70,239,0.18)' }}
                                            >
                                                <div style={barStyle(inFee, maxInbound, darkMode ? '#f5a7ff' : '#d946ef')} className="h-full" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between mb-1">
                                                <span className="font-semibold" style={{ color: darkMode ? '#a5b4fc' : '#3730a3' }}>
                                                    Network Avg Fees To Peer
                                                </span>
                                                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                    {peerFeeStats ? `${peerFeeStats.correctedAvg.toFixed(0)} ppm` : '—'}
                                                </span>
                                            </div>
                                            <div
                                                className="h-2.5 rounded-full overflow-hidden"
                                                style={{ backgroundColor: darkMode ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.18)' }}
                                            >
                                                <div style={barStyle(networkIn, maxOutbound, darkMode ? '#a5b4fc' : '#4f46e5')} className="h-full" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between mb-1">
                                                <span className="font-semibold" style={{ color: darkMode ? '#fbbf24' : '#b45309' }}>
                                                    Network Avg Fees From Peer
                                                </span>
                                                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                    {peerOutFeeStats ? `${peerOutFeeStats.correctedAvg.toFixed(0)} ppm` : '—'}
                                                </span>
                                            </div>
                                            <div
                                                className="h-2.5 rounded-full overflow-hidden"
                                                style={{ backgroundColor: darkMode ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.18)' }}
                                            >
                                                <div style={barStyle(networkOut, maxInbound, darkMode ? '#fbbf24' : '#f59e0b')} className="h-full" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* PROPS ADVISOR SECTION */}
                        <div className="mt-6 rounded-xl overflow-hidden transition-all duration-300"
                            style={{
                                backgroundColor: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)',
                                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`
                            }}>
                            <div className="flex items-center justify-between px-5 py-4 border-b bg-black/5" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))' }}>
                                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Props Advisor</h4>
                                        <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Protected intelligence fee optimization</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    {phalaModeEnabled && (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-1 rounded-lg border p-1"
                                                style={{
                                                    borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                                    backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setAnalysisMode('standard')}
                                                    className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all"
                                                    style={{
                                                        backgroundColor: activeAnalysisMode === 'standard' ? 'rgba(34,211,238,0.16)' : 'transparent',
                                                        color: activeAnalysisMode === 'standard' ? 'var(--accent-1)' : 'var(--text-secondary)',
                                                    }}
                                                >
                                                    Standard
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => phalaModeAvailable && setAnalysisMode('phala_verified')}
                                                    disabled={!phalaModeAvailable}
                                                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${!phalaModeAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}
                                                    style={{
                                                        backgroundColor: activeAnalysisMode === 'phala_verified' ? 'rgba(59,130,246,0.18)' : 'transparent',
                                                        color: activeAnalysisMode === 'phala_verified' ? '#60a5fa' : 'var(--text-secondary)',
                                                    }}
                                                    title={phalaModeAvailable ? 'Use the Phala verified path' : (PHALA_UI_CONFIG.reason || 'Phala verified path is unavailable')}
                                                >
                                                    Verified Phala
                                                </button>
                                            </div>
                                            {!phalaModeAvailable && (
                                                <span className="text-[10px]" style={{ color: darkMode ? '#fda4af' : '#9f1239' }}>
                                                    {PHALA_UI_CONFIG.reason || 'Phala verified path is unavailable.'}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <button
                                        onClick={handleRunChannelAnalysis}
                                        disabled={propsLoading}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${propsLoading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
                                        style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))', color: '#fff' }}
                                    >
                                        {propsLoading
                                            ? (activeAnalysisMode === 'phala_verified' ? 'Running Verified Phala...' : 'Running Props...')
                                            : propsRecommendation
                                                ? 'Re-run Analysis'
                                                : 'Analyze Channel'}
                                    </button>
                                </div>
                            </div>

                            {propsError && (
                                <div className="px-5 py-3 text-xs border-b"
                                    style={{
                                        color: darkMode ? '#fda4af' : '#9f1239',
                                        backgroundColor: darkMode ? 'rgba(244,63,94,0.08)' : 'rgba(244,63,94,0.1)',
                                        borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                    }}>
                                    {propsError}
                                </div>
                            )}

                            {propsRecommendation && (
                                <div className="p-5 animate-fade-in space-y-6">
                                    <div className="flex flex-col md:flex-row items-start gap-6">

                                        <div className="flex-1 w-full space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Suggested Action</span>
                                                <div className="flex items-center gap-2">
                                                    {verifyResult?.ok && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold uppercase tracking-widest">
                                                            ARB Verified
                                                        </span>
                                                    )}
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${propsRecommendation.action?.toLowerCase() === 'lower' || propsRecommendation.action?.toLowerCase() === 'decrease' ? 'bg-rose-500/20 text-rose-500' :
                                                            propsRecommendation.action?.toLowerCase() === 'raise' || propsRecommendation.action?.toLowerCase() === 'increase' ? 'bg-emerald-500/20 text-emerald-500' :
                                                                'bg-blue-500/20 text-blue-500'
                                                        }`}>
                                                        {propsRecommendation.action}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Target Fee Rate</span>
                                                <div className="flex items-center gap-3">
                                                    {(() => {
                                                        const currentFee = getFeeRatePpm(selectedChannel.myPolicy);
                                                        const suggestedFee = propsRecommendation.suggestedFeePpm;
                                                        const hasChange = suggestedFee !== null && Number(suggestedFee) !== Number(currentFee);

                                                        return (
                                                            <>
                                                                <span className={`text-sm font-mono ${hasChange ? 'text-rose-500 font-bold' : 'opacity-50'}`}>
                                                                    {currentFee} ppm
                                                                </span>
                                                                <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                                                </svg>
                                                                <span className="font-mono text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                                                    {suggestedFee !== null ? `${suggestedFee} ppm` : '1 ppm'}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Model Confidence</span>
                                                <span className="font-mono text-sm text-white/70">{((propsRecommendation.confidence || 0) * 100).toFixed(1)}%</span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Analysis Route</span>
                                                <span className="font-mono text-xs" style={{ color: activeAnalysisMode === 'phala_verified' ? '#60a5fa' : 'var(--text-secondary)' }}>
                                                    {activeAnalysisMode === 'phala_verified' ? 'Verified Phala' : 'Standard API'}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Verification</span>
                                                <span className="font-mono text-xs" style={{ color: verifyResult?.ok ? '#22c55e' : '#f97316' }}>
                                                    {verifyResult ? (verifyResult.ok ? 'ARB verified' : 'Verification failed') : 'Pending'}
                                                </span>
                                            </div>

                                            {phalaRun && (
                                                <div className="rounded-xl p-4 space-y-3"
                                                    style={{
                                                        backgroundColor: darkMode ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)',
                                                        border: `1px solid ${darkMode ? 'rgba(96,165,250,0.18)' : 'rgba(59,130,246,0.14)'}`,
                                                    }}>
                                                    <div className="flex items-center justify-between">
                                                        <h5 className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Phala Trust Status</h5>
                                                        <span className="text-[10px] font-mono" style={{ color: verifyResult?.ok ? '#22c55e' : '#f97316' }}>
                                                            {verifyResult?.ok ? 'Verified' : 'Needs review'}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Signer</span>
                                                            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                                                                {shortHash(verifyResult?.signerPolicy?.providerRuntimeId || verifyResult?.signerPolicy?.allowedSignerProviderId)}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Signer Type</span>
                                                            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                                                                {verifyResult?.signerPolicy?.expectedSignerProviderType || 'â€”'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Quote Check</span>
                                                            <span className="font-mono" style={{ color: phalaRun?.verify?.cloudVerification?.quoteVerified ? '#22c55e' : '#f97316' }}>
                                                                {phalaRun?.verify?.cloudVerification?.quoteVerified ? 'Cloud verified' : 'Unavailable'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Measurement</span>
                                                            <span className="font-mono" style={{ color: phalaRun?.health?.measurementPolicy?.pinned ? '#22c55e' : '#f97316' }}>
                                                                {phalaRun?.health?.measurementPolicy?.pinned
                                                                    ? shortHash(phalaRun?.health?.measurementPolicy?.allowedMeasurement)
                                                                    : 'Not pinned'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Attestation Source</span>
                                                            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                                                                {phalaRun?.health?.attestationSource || 'â€”'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span style={{ color: 'var(--text-secondary)' }}>Live Evidence</span>
                                                            <span className="font-mono" style={{ color: verifyResult?.liveAppEvidencePolicy?.requireLiveAppEvidence ? '#22c55e' : 'var(--text-secondary)' }}>
                                                                {verifyResult?.liveAppEvidencePolicy?.requireLiveAppEvidence ? 'Required' : 'Optional'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {(propsRecommendation.reasonCodes || propsRecommendation.reasons)?.length > 0 && (
                                                <div>
                                                    <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Signals</div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {(propsRecommendation.reasonCodes || propsRecommendation.reasons).map((reason) => (
                                                            <span
                                                                key={reason}
                                                                className="px-2 py-1 rounded-full text-[10px] font-mono"
                                                                style={{
                                                                    backgroundColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                                                                    color: 'var(--text-secondary)',
                                                                }}
                                                            >
                                                                {reason}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                    </div>

                                    {/* Gemini Analysis Section */}
                                    <div className="pt-6 border-t border-white/10">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 flex items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400">
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                    </svg>
                                                </div>
                                                <h4 className="text-xs font-bold uppercase tracking-widest text-indigo-300">Gemini Second Opinion</h4>
                                            </div>

                                            {!geminiAnalysis && !geminiLoading && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            setGeminiLoading(true);
                                                            const gRes = await postAnalyzeGemini(pipelineData.propsPayload, propsRecommendation);
                                                            if (gRes.ok) setGeminiAnalysis(gRes.analysis);
                                                        } catch (gErr) {
                                                            console.warn('Gemini analysis failed:', gErr);
                                                        } finally {
                                                            setGeminiLoading(false);
                                                        }
                                                    }}
                                                    className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-tight flex items-center gap-1"
                                                >
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                    </svg>
                                                    Verify with AI
                                                </button>
                                            )}
                                        </div>

                                        {geminiLoading ? (
                                            <div className="flex items-center gap-2 text-[10px] text-indigo-400/60 font-mono animate-pulse">
                                                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></div>
                                                AI is reviewing the recommendation...
                                            </div>
                                        ) : geminiAnalysis ? (
                                            <div className="rounded-xl p-4 bg-indigo-500/5 border border-indigo-500/10">
                                                <p className="text-[11px] leading-relaxed text-indigo-200/80 italic">
                                                    "{geminiAnalysis}"
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-indigo-400/40 italic">
                                                Click "Verify with AI" to get an intelligent second opinion on this recommendation.
                                            </div>
                                        )}
                                    </div>

                                    {/* Reasons & Signals section */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] uppercase tracking-widest font-bold text-white/30">Analysis Reasons</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {propsRecommendation.reasons?.map((reason, idx) => (
                                                    <span key={idx} className="px-2 py-0.5 rounded bg-white/5 border border-white/5 text-[10px] text-white/60 capitalize">
                                                        {reason.replace(/_/g, ' ')}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <h4 className="text-[10px] uppercase tracking-widest font-bold text-white/30">Market Signals</h4>
                                                <div className="grid grid-cols-1 gap-y-1.5">
                                                    {propsRecommendation.signals && Object.entries(propsRecommendation.signals).map(([key, value], idx) => (
                                                        <div key={idx} className="flex justify-between items-center text-[11px]">
                                                            <span className="text-white/30 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                                            <span className="text-white/70 font-mono font-bold uppercase">{String(value)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!propsRecommendation && !propsLoading && (
                                <div className="p-5 text-sm flex items-center justify-center text-center text-white/40 h-32">
                                    Click Analyze Channel to bundle the telemetry and request a Fee Policy recommendation from the Props Pipeline.
                                </div>
                            )}
                            {propsLoading && (
                                <div className="p-5 flex flex-col items-center justify-center h-32 space-y-3">
                                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-xs text-indigo-400 font-mono animate-pulse">Running Props Inference Pipeline...</p>
                                </div>
                            )}

                            {pipelineData.rawMetadata && (
                                <div className="border-t bg-black/10 transition-colors hover:bg-black/20" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                                    <button
                                        className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold transition-all duration-200"
                                        style={{ color: darkMode ? 'var(--accent-1)' : 'var(--accent-2)' }}
                                        onClick={() => setShowPipeline(!showPipeline)}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-md bg-white/5 border border-white/5">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                                </svg>
                                            </div>
                                            PROPS Pipeline Explorer
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-50">
                                            {showPipeline ? 'Hide' : 'Expand'}
                                            <svg className={`w-3 h-3 transform transition-transform duration-300 ${showPipeline ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </button>

                                    {showPipeline && (
                                        <div className="px-5 pb-6 animate-fade-in space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                                {/* Stage 1: Raw */}
                                                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-500 flex items-center justify-center text-[10px] font-bold">1</div>
                                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-500/80">Raw Retrieval</h4>
                                                    </div>
                                                    <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Full channel context & MC pairs extracted locally.</p>
                                                    <button
                                                        className="w-full py-1.5 rounded-lg bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                                                        onClick={() => setModalConfig({ isOpen: true, title: 'Stage 1: Raw LND Extraction', data: pipelineData.rawMetadata })}
                                                    >
                                                        View Raw
                                                    </button>
                                                </div>

                                                {/* Stage 2: Normalized */}
                                                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-500 flex items-center justify-center text-[10px] font-bold">2</div>
                                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-500/80">Normalized</h4>
                                                    </div>
                                                    <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Structured node-state for efficient analysis.</p>
                                                    <button
                                                        className="w-full py-1.5 rounded-lg bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase border border-blue-500/20 hover:bg-blue-500/20 transition-all"
                                                        onClick={() => setModalConfig({ isOpen: true, title: 'Stage 2: Normalized Metadata', data: pipelineData.normalizedMetadata })}
                                                    >
                                                        View Normalized
                                                    </button>
                                                </div>

                                                {/* Stage 3: PROPS */}
                                                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-[10px] font-bold">3</div>
                                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/80">PROPS Shield</h4>
                                                    </div>
                                                    <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Anonymized, banded & rounded for transmission.</p>
                                                    <button
                                                        className="w-full py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                                        onClick={() => setModalConfig({ isOpen: true, title: 'Stage 3: PROPS Final Payload', data: pipelineData.propsPayload })}
                                                    >
                                                        Inspect Payload
                                                    </button>
                                                </div>

                                                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-5 h-5 rounded-md bg-violet-500/20 text-violet-400 flex items-center justify-center text-[10px] font-bold">4</div>
                                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-400/80">Outgoing Request</h4>
                                                    </div>
                                                    <div className="space-y-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                                                        <p>Route: <span style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.route || 'Unavailable'}</span></p>
                                                        <p>Transport: <span style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.transport || 'Unavailable'}</span></p>
                                                        <p>Requests: <span style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.requests?.length || 0}</span></p>
                                                    </div>
                                                    <button
                                                        className="w-full py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-[10px] font-bold uppercase border border-violet-500/20 hover:bg-violet-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                        onClick={() => setModalConfig({ isOpen: true, title: 'Stage 4: Outgoing Browser Requests', data: pipelineData.outgoingInspector })}
                                                        disabled={!pipelineData.outgoingInspector}
                                                    >
                                                        Inspect Requests
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="rounded-lg p-3 bg-indigo-500/5 border border-indigo-500/10">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <h5 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Props Architecture</h5>
                                                </div>
                                                <p className="text-[10px] leading-relaxed text-indigo-300/60">
                                                    Protected Pipelines (PROPS) preserve privacy by applying client-side transformations (`f(X)`) before data leaves your infrastructure.
                                                    Sensitive IDs are masked and balances are banded to prevent individual node recognition.
                                                </p>
                                            </div>

                                            <p className="text-[9px] text-white/20 text-center uppercase tracking-tighter">This telemetry packet is processed inside a protected TEE inference boundary.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>

                    </div>
                    <DataModal
                        isOpen={modalConfig.isOpen}
                        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                        title={modalConfig.title}
                        data={modalConfig.data}
                        darkMode={darkMode}
                    />
                </div>
                , document.body)}
        </div>
    );
};

export default ChannelsPage;
