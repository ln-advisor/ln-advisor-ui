import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { postRecommend, postSnapshot, buildFrontendTelemetryEnvelope } from '../api/telemetryClient';


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

const ChannelsPage = ({ lnc, darkMode, nodeChannels = [] }) => {
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
    const [showPayload, setShowPayload] = useState(false);
    const [lastTelemetry, setLastTelemetry] = useState(null);

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
                                                setShowPayload(false);
                                                setLastTelemetry(null);
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
                    onClick={() => setFeeModalOpen(false)}
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
                                onClick={() => setFeeModalOpen(false)}
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
                                                            {getTicks(inboundHist.maxCount).map((t) => (
                                                                <div key={`in-tick-${t}`} className="h-0 leading-none">{t}</div>
                                                            ))}
                                                        </div>
                                                        <div className="relative flex-1">
                                                            <div className="absolute inset-0 pointer-events-none">
                                                                {getTicks(inboundHist.maxCount).map((t) => (
                                                                    <div
                                                                        key={`in-line-${t}`}
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
                                                            {getTicks(outboundHist.maxCount).map((t) => (
                                                                <div key={`out-tick-${t}`} className="h-0 leading-none">{t}</div>
                                                            ))}
                                                        </div>
                                                        <div className="relative flex-1">
                                                            <div className="absolute inset-0 pointer-events-none">
                                                                {getTicks(outboundHist.maxCount).map((t) => (
                                                                    <div
                                                                        key={`out-line-${t}`}
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
                                <button
                                    onClick={async () => {
                                        setPropsLoading(true);
                                        try {
                                            const rawTelemetry = {
                                                nodeInfo: { alias: "Local Advisor Node" }, // MUST provide a node identifier for provenance
                                                channels: [{
                                                    chanId: selectedChannel.chanId,
                                                    remotePubkey: selectedChannel.peerPubkey,
                                                    capacity: selectedChannel.capacity,
                                                    localBalance: selectedChannel.local,
                                                    remoteBalance: selectedChannel.remote,
                                                }],
                                                forwardingHistory: [],
                                                feePolicies: [
                                                    {
                                                        channelId: selectedChannel.chanId,
                                                        directionPubKey: "self", 
                                                        feeRatePpm: getFeeRatePpm(selectedChannel.myPolicy)
                                                    },
                                                    {
                                                        channelId: selectedChannel.chanId,
                                                        directionPubKey: selectedChannel.peerPubkey,
                                                        feeRatePpm: getFeeRatePpm(selectedChannel.peerPolicy)
                                                    }
                                                ],
                                                // Additional metrics for context
                                                metadata: {
                                                    routingStatsOutMsat: selectedChannel.stats.feeOutMsat,
                                                    routingStatsInMsat: selectedChannel.stats.feeInMsat,
                                                    networkInAvg: peerFeeStats?.correctedAvg,
                                                    networkOutAvg: peerOutFeeStats?.correctedAvg,
                                                },
                                                peerFeeSeries: { ...peerFeeSeries }
                                            };

                                            setLastTelemetry(rawTelemetry); // Store RAW for metadata display to avoid crash
                                            const telemetryEnvelope = buildFrontendTelemetryEnvelope(rawTelemetry);
                                            
                                            // 1. Post Snapshot (completes the pipeline flow)
                                            await postSnapshot(telemetryEnvelope);

                                            // 2. Post Recommend
                                            const res = await postRecommend({
                                                telemetry: telemetryEnvelope,
                                                privacyMode: 'banded'
                                            });

                                            if (res && res.recommendation) {
                                                setPropsRecommendation(res.recommendation);
                                            }
                                        } catch (err) {
                                            console.error('Props pipeline failed:', err);
                                            setError('Props pipeline failed: ' + (err.message || 'Unknown error'));
                                        } finally {
                                            setPropsLoading(false);
                                        }
                                    }}
                                    disabled={propsLoading}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${propsLoading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
                                    style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))', color: '#fff' }}
                                >
                                    {propsLoading ? 'Running Model...' : propsRecommendation ? 'Re-run Analysis' : 'Analyze Channel'}
                                </button>
                            </div>

                            {propsRecommendation && (
                                <div className="p-5 animate-fade-in">
                                    <div className="flex flex-col md:flex-row items-center gap-6">

                                        <div className="flex-1 w-full space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Suggested Action</span>
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${propsRecommendation.action === 'Decrease' ? 'bg-rose-500/20 text-rose-500' : propsRecommendation.action === 'Increase' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/20 text-blue-500'}`}>
                                                    {propsRecommendation.action}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Target Fee Rate</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs line-through opacity-50 font-mono">{getFeeRatePpm(selectedChannel.myPolicy)}</span>
                                                    <svg className="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                                    </svg>
                                                    <span className="font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{propsRecommendation.suggestedPpm} ppm</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Model Confidence</span>
                                                <span className="font-mono text-sm text-white/70">{(propsRecommendation.confidenceScore * 100).toFixed(1)}%</span>
                                            </div>
                                        </div>

                                        <div className="w-full md:w-px h-px md:h-24 bg-white/10"></div>

                                        <div className="flex-1 w-full">
                                            <button
                                                className="w-full py-3 rounded-xl text-sm font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
                                                style={{ background: 'var(--accent-1)', color: '#fff' }}
                                            >
                                                <span>Execute via OpenClaw</span>
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </button>
                                            <p className="text-center text-[10px] mt-2 opacity-50">Requires Arb Signature Verification</p>
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

                            {lastTelemetry && (
                                <div className="border-t bg-black/10 transition-colors hover:bg-black/20" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                                    <button
                                        className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold transition-all duration-200"
                                        style={{ color: darkMode ? 'var(--accent-1)' : 'var(--accent-2)' }}
                                        onClick={() => setShowPayload(!showPayload)}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-md bg-white/5 border border-white/5">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                                </svg>
                                            </div>
                                            View Extraction Metadata
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-50">
                                            {showPayload ? 'Collapse' : 'Expand'}
                                            <svg className={`w-3 h-3 transform transition-transform duration-300 ${showPayload ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </button>

                                    {showPayload && (
                                        <div className="px-5 pb-6 animate-fade-in">
                                            <div className="bg-black/50 rounded-xl p-5 overflow-x-auto border border-white/10 shadow-inner font-mono text-[11px] leading-relaxed">
                                                <pre className="text-emerald-400/90 whitespace-pre">
                                                    {JSON.stringify(lastTelemetry, (key, value) => {
                                                        if (Array.isArray(value)) return `[Array(${value.length})]`;
                                                        return value;
                                                    }, 2)}
                                                </pre>
                                                <div className="mt-4 pt-4 border-t border-white/5 space-y-1">
                                                    <p className="text-[10px] text-white/30 uppercase tracking-tighter">Detailed Series (Omitted for brevity)</p>
                                                    <pre className="text-white/20 whitespace-pre-wrap">
                                                        {JSON.stringify({
                                                            incoming: `[${lastTelemetry.peerFeeSeries?.incoming?.length || 0} items]`,
                                                            outgoing: `[${lastTelemetry.peerFeeSeries?.outgoing?.length || 0} items]`
                                                        }, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                            <p className="mt-4 text-[10px] text-white/40 text-center font-medium">This telemetry packet is processed inside a protected TEE inference boundary.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>

                    </div>
                </div>
                , document.body)}
        </div>
    );
};

export default ChannelsPage;
