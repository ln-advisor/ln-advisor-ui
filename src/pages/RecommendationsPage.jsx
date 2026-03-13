import React, { useCallback, useMemo, useState } from 'react';
import {
    ResponsiveContainer,
    BarChart, Bar,
    XAxis, YAxis,
    Tooltip, CartesianGrid, Legend,
    PieChart, Pie, Cell,
} from 'recharts';
import SectionBadge from '../components/analysis/SectionBadge';
import ErrorBanner from '../components/analysis/ErrorBanner';
import InlineSpinner from '../components/analysis/InlineSpinner';
import DataSourceLegend from '../components/analysis/DataSourceLegend';
import {
    postChannelOpeningRecommendations,
} from '../api/telemetryClient';
import { normalizeSnapshot } from '../normalization/normalizeSnapshot';
import { applyPrivacyPolicy } from '../privacy/applyPrivacyPolicy';

const shortHex = (s, n = 10) => {
    if (!s) return '—';
    const v = String(s);
    if (v.length <= n) return v;
    return `${v.slice(0, Math.max(4, Math.floor(n / 2)))}…${v.slice(-Math.max(4, Math.floor(n / 2)))}`;
};

const toNum = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return 0;
        const n = Number(t);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

const fmtSats = (n) => {
    const num = toNum(n);
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return Math.round(num).toLocaleString();
};

const StatCard = ({ title, value, sub, color, darkMode, badge }) => (
    <div
        className="rounded-2xl p-6 flex flex-col gap-3 transition-all duration-300 relative overflow-hidden group hover:scale-[1.02]"
        style={{
            backgroundColor: 'var(--bg-card)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
            boxShadow: 'var(--card-shadow)',
        }}
    >
        <div className="absolute top-0 left-0 w-1 h-full rounded-full" style={{ background: color || 'var(--accent-1)' }} />
        <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>
                {title}
            </p>
            {badge && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ background: badge.bg, color: badge.text }}>
                    {badge.label}
                </span>
            )}
        </div>
        <p className="text-3xl font-display font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
        {sub && <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
    </div>
);

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

const RecommendationCard = ({ rec, darkMode }) => {
    const scoreColor = rec.score > 500 ? 'var(--accent-1)' : rec.score > 200 ? 'var(--accent-2)' : 'var(--accent-3)';
    
    return (
        <div
            className="rounded-2xl overflow-hidden transition-all duration-300 group hover:shadow-2xl"
            style={{
                backgroundColor: 'var(--bg-card)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)'}`,
                boxShadow: 'var(--card-shadow)',
            }}
        >
            <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${scoreColor}, transparent)` }} />
            <div className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <h3 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                            {rec.alias || 'Unknown Node'}
                        </h3>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {rec.pubkey ? shortHex(rec.pubkey, 24) : shortHex(rec.peerRef, 24)}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-black font-display" style={{ color: scoreColor }}>
                            {Math.round(rec.score)}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                            Score
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {rec.reasons.map((reason, idx) => (
                        <span 
                            key={idx}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight"
                            style={{ 
                                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
                                color: 'var(--text-primary)',
                                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`
                            }}
                        >
                            {reason.replace(/_/g, ' ')}
                        </span>
                    ))}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }}>
                    <div className="text-center">
                        <div className="text-[10px] font-bold uppercase tracking-tighter mb-1" style={{ color: 'var(--text-secondary)' }}>Centrality</div>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" 
                            style={{ 
                                background: rec.signals.centralityBand === 'HIGH' ? 'rgba(34,211,238,0.1)' : 'transparent',
                                color: rec.signals.centralityBand === 'HIGH' ? 'var(--accent-1)' : 'var(--text-secondary)'
                            }}>
                            {rec.signals.centralityBand}
                        </span>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold uppercase tracking-tighter mb-1" style={{ color: 'var(--text-secondary)' }}>Reliability</div>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                             style={{ 
                                background: rec.signals.reliabilityBand === 'HIGH' ? 'rgba(34,197,94,0.1)' : 'transparent',
                                color: rec.signals.reliabilityBand === 'HIGH' ? '#22c55e' : 'var(--text-secondary)'
                            }}>
                            {rec.signals.reliabilityBand}
                        </span>
                    </div>
                    <div className="text-center">
                        <div className="text-[10px] font-bold uppercase tracking-tighter mb-1" style={{ color: 'var(--text-secondary)' }}>Capacity</div>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                            style={{ color: 'var(--text-secondary)' }}>
                            {rec.signals.capacityBand}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RecommendationsPage = ({ lnc, darkMode }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [graph, setGraph] = useState(null);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [channels, setChannels] = useState([]);
    const [peers, setPeers] = useState([]);
    const [nodeMetrics, setNodeMetrics] = useState(null);
    const [missionControl, setMissionControl] = useState(null);
    
    const [recommendations, setRecommendations] = useState([]);
    const [advisorLoading, setAdvisorLoading] = useState(false);
    const [advisorError, setAdvisorError] = useState(null);
    
    // Pipeline Explorer State
    const [showPipeline, setShowPipeline] = useState(false);
    const [pipelineData, setPipelineData] = useState({
        rawMetadata: null,
        normalizedMetadata: null,
        propsPayload: null
    });
    
    // Modal State
    const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', data: null });

    const fetchData = useCallback(async () => {
        if (!lnc?.lnd?.lightning) {
            setError('LNC Session not connected.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setAdvisorError(null);

        try {
            const [info, chans, p, g, metrics, mc] = await Promise.all([
                lnc.lnd.lightning.getInfo({}),
                lnc.lnd.lightning.listChannels({}),
                lnc.lnd.lightning.listPeers({}),
                lnc.lnd.lightning.describeGraph({ include_unannounced: false }),
                lnc.lnd.lightning.getNodeMetrics({ types: ['BETWEENNESS_CENTRALITY'] }),
                lnc.lnd.router.queryMissionControl({}),
            ]);

            setNodeInfo(info);
            setChannels(Array.isArray(chans?.channels) ? chans.channels : []);
            setPeers(Array.isArray(p?.peers) ? p.peers : []);
            setGraph(g || { nodes: [], edges: [] });
            setNodeMetrics(metrics || { betweennessCentrality: {} });
            setMissionControl(mc || { pairs: [] });
        } catch (e) {
            console.error('Fetch failed:', e);
            setError(e.message || 'Failed to fetch node data.');
        } finally {
            setIsLoading(false);
        }
    }, [lnc]);

    const runAdvisor = useCallback(async () => {
        if (!graph) {
            setAdvisorError('Fetch base data first.');
            return;
        }

        setAdvisorLoading(true);
        setAdvisorError(null);

        try {
            // Stage 1: Raw Metadata
            const rawMetadataSnapshot = {
                nodes: graph.nodes?.length || 0,
                edges: graph.edges?.length || 0,
                peers: peers?.length || 0,
                channels: channels?.length || 0,
                missionControlPairs: missionControl?.pairs?.length || 0,
                _raw: {
                    info: nodeInfo,
                    channels: channels.slice(0, 50),
                    missionControlCount: missionControl?.pairs?.length || 0
                }
            };

            // Stage 2: Normalization
            const normalizedSnapshot = normalizeSnapshot({
                nodeInfo,
                channels,
                peers,
                graphNodes: graph.nodes,
                graphEdges: graph.edges,
                nodeCentralityMetrics: Object.entries(nodeMetrics?.betweennessCentrality || {}).map(([pk, bc]) => ({
                    nodePubkey: pk,
                    betweennessCentrality: bc
                })),
                missionControlPairs: missionControl?.pairs,
                collectedAt: new Date().toISOString()
            });

            // Stage 3: PROPS Privacy Filter
            // This is the actual payload sent to the server — anonymised ratios and
            // references only, no raw pubkeys, real balances, or channel IDs.
            const propsTelemetry = applyPrivacyPolicy(normalizedSnapshot, 'feature_only');

            setPipelineData({
                rawMetadata: rawMetadataSnapshot,
                normalizedMetadata: normalizedSnapshot,
                propsPayload: propsTelemetry
            });

            // ── Channel Opening Recommendations ──────────────────────────────
            // Route: POST /api/recommend/channel-openings
            // Payload: PROPS feature_only state (peer aggregates, potential peer
            // centrality scores, node-level totals). No raw identifiers.
            const res = await postChannelOpeningRecommendations({
                propsPayload: propsTelemetry,
                privacyMode: 'feature_only',
            });

            if (res.ok && res.recommendation?.channelOpeningRecommendations) {
                // Map the pseudo-anonymized peerRefs back to the raw potentialPeers stored in normalizedSnapshot
                const mappedRecommendations = res.recommendation.channelOpeningRecommendations.map(rec => {
                    // Props telemetry deterministic peer map
                    const mappingPeer = propsTelemetry.potentialPeers.find(p => p.peerRef === rec.peerRef);
                    if (!mappingPeer) return rec; // Fallback to raw if not found

                    const potentialPeerIndex = propsTelemetry.potentialPeers.indexOf(mappingPeer);

                    // We sort the normalized potential peers the exact same way applyPrivacyPolicy sorts
                    // them to deterministically map index -> actual node info.
                    const sortedOriginalPeers = [...normalizedSnapshot.potentialPeers].sort((a, b) => 
                        a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0
                    );

                    const originalPeer = sortedOriginalPeers[potentialPeerIndex];
                    
                    return {
                        ...rec,
                        pubkey: originalPeer?.pubkey,
                        alias: originalPeer?.alias,
                    };
                });
                
                setRecommendations(mappedRecommendations);
            } else {
                throw new Error('No recommendations generated by the advisor.');
            }
        } catch (e) {
            console.error('Advisor failed:', e);
            setAdvisorError(e.message || 'Advisor analysis failed.');
        } finally {
            setAdvisorLoading(false);
        }
    }, [graph, nodeInfo, channels, peers, missionControl, nodeMetrics]);

    const stats = useMemo(() => {
        const nodes = graph?.nodes?.length || 0;
        const edges = graph?.edges?.length || 0;
        const totalCap = (graph?.edges || []).reduce((acc, e) => acc + toNum(e.capacity), 0);
        return { nodes, edges, totalCap };
    }, [graph]);

    return (
        <div className="px-6 pb-12 pt-8 space-y-10" style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="text-3xl font-black font-display tracking-tight" style={{ color: 'var(--text-primary)' }}>
                                Channel Advisor
                            </h1>
                            <div className="flex items-center gap-2 mt-1">
                                <SectionBadge label="Altruistic Mode" variant="public" />
                                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                                    Network Health Optimization
                                </span>
                            </div>
                        </div>
                    </div>
                    <p className="text-sm max-w-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        Identify liquidity gaps and high-centrality nodes to strengthen the Lightning Network. 
                        Our algorithm prioritizes connectivity over individual fee extraction.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchData}
                        disabled={isLoading}
                        className="px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 flex items-center gap-2"
                        style={{
                            background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
                            color: 'var(--text-primary)',
                            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
                            opacity: isLoading ? 0.7 : 1,
                        }}
                    >
                        {isLoading && <InlineSpinner size="sm" />}
                        {isLoading ? 'Syncing...' : 'Sync Graph Data'}
                    </button>
                    <button
                        onClick={runAdvisor}
                        disabled={advisorLoading || !graph}
                        className="px-8 py-3 rounded-xl font-bold text-sm text-white transition-all duration-300 shadow-xl"
                        style={{
                            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
                            boxShadow: darkMode ? '0 10px 25px -5px rgba(34,211,238,0.4)' : '0 10px 25px -5px rgba(37,99,235,0.3)',
                            opacity: (advisorLoading || !graph) ? 0.6 : 1,
                        }}
                    >
                        {advisorLoading ? 'Analyzing...' : 'Generate Recommendations'}
                    </button>
                </div>
            </div>

            <ErrorBanner message={error || advisorError} />

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                    title="Network Nodes" 
                    value={stats.nodes.toLocaleString()} 
                    sub="Explored Graph Nodes"
                    color="var(--accent-2)"
                    darkMode={darkMode}
                />
                <StatCard 
                    title="Network Edges" 
                    value={stats.edges.toLocaleString()} 
                    sub="Total Gossip Channels"
                    color="var(--accent-1)"
                    darkMode={darkMode}
                />
                <StatCard 
                    title="Total Capacity" 
                    value={fmtSats(stats.totalCap)} 
                    sub="Aggregated Network Liquidity"
                    color="var(--accent-3)"
                    darkMode={darkMode}
                />
            </div>

            {/* Content Area */}
            <div className="space-y-6">
                <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <h2 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                        Top Recommendations
                    </h2>
                    {recommendations.length > 0 && (
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                            {recommendations.length} Suggestions Found
                        </span>
                    )}
                </div>

                {advisorLoading && (
                    <div className="py-20 flex flex-col items-center justify-center space-y-4">
                        <div className="w-12 h-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-500 animate-spin" />
                        <p className="text-sm font-bold animate-pulse text-cyan-500">Processing graph centrality and mission logs...</p>
                    </div>
                )}

                {!advisorLoading && recommendations.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {recommendations.map((rec) => (
                            <RecommendationCard key={rec.pubkey} rec={rec} darkMode={darkMode} />
                        ))}
                    </div>
                )}

                {!advisorLoading && recommendations.length === 0 && !error && !advisorError && (
                    <div className="rounded-3xl p-16 text-center space-y-4" style={{ backgroundColor: 'var(--bg-card)', border: `2px dashed ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)'}` }}>
                        <div className="w-16 h-16 rounded-full bg-slate-500/10 flex items-center justify-center mx-auto text-slate-500">
                            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>No Recommendations Yet</h3>
                            <p className="text-sm max-w-xs mx-auto" style={{ color: 'var(--text-secondary)' }}>
                                Sync your node's graph view first, then generate intelligent suggestions for new channels.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Pipeline Explorer & PROPS Explanation */}
            <div className="space-y-6">
                <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                            PROPS Pipeline Explorer
                        </h2>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 text-[10px] font-bold uppercase tracking-widest">
                            Privacy Shield
                        </span>
                    </div>
                    <button 
                        onClick={() => setShowPipeline(!showPipeline)}
                        className="text-xs font-bold text-cyan-500 hover:text-cyan-400 transition-colors uppercase tracking-widest"
                    >
                        {showPipeline ? 'Hide Explorer' : 'Explore Data Flow'}
                    </button>
                </div>

                {showPipeline && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
                        {/* Stage 1: Raw Data Extraction */}
                        <div className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-500 flex items-center justify-center text-xs font-bold">1</div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-500/80">LND Raw Metadata</h4>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Graph Nodes</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.nodes || 0}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Graph Edges</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.edges || 0}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Mission Control</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.missionControlPairs || 0}</span>
                                </div>
                            </div>
                            {pipelineData.rawMetadata && (
                                <div className="pt-2">
                                    <button 
                                        className="w-full py-1.5 rounded-lg bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-widest border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                                        onClick={() => setModalConfig({ 
                                            isOpen: true, 
                                            title: 'Stage 1: Raw LND Extraction', 
                                            data: pipelineData.rawMetadata 
                                        })}
                                    >
                                        View Raw Data
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Stage 2: Normalization */}
                        <div className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-500 flex items-center justify-center text-xs font-bold">2</div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-500/80">Normalization Layer</h4>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Target Peers</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.normalizedMetadata?.potentialPeers?.length || 0}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Calculated Metrics</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>BC Centrality, Reliability</span>
                                </div>
                            </div>
                            <p className="text-[10px] leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>
                                Raw data is transformed into node-state structures. Internal cross-referencing happens here.
                            </p>
                            {pipelineData.normalizedMetadata && (
                                <div className="pt-2">
                                    <button 
                                        className="w-full py-1.5 rounded-lg bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase tracking-widest border border-blue-500/20 hover:bg-blue-500/20 transition-all"
                                        onClick={() => setModalConfig({ 
                                            isOpen: true, 
                                            title: 'Stage 2: Normalized Node State', 
                                            data: pipelineData.normalizedMetadata 
                                        })}
                                    >
                                        View Normalized
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Stage 3: PROPS Privacy Filter */}
                        <div className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold">3</div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/80">PROPS Transmitted Payload</h4>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Privacy Mode</span>
                                    <span className="font-mono font-bold text-emerald-500">FEATURE_ONLY</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: 'var(--text-secondary)' }}>Data Masking</span>
                                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>Banding & Rounding</span>
                                </div>
                            </div>
                            {pipelineData.propsPayload && (
                                <div className="pt-2">
                                    <button 
                                        className="w-full py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-widest border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                        onClick={() => setModalConfig({ 
                                            isOpen: true, 
                                            title: 'Stage 3: PROPS Protected Payload', 
                                            data: pipelineData.propsPayload 
                                        })}
                                    >
                                        Inspect Final Payload
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div 
                    className="rounded-2xl p-8 space-y-6"
                    style={{ 
                        backgroundColor: darkMode ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.03)',
                        border: `1px solid ${darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.1)'}`
                    }}
                >
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                        <div className="flex-1 space-y-4">
                            <div className="flex items-center gap-3 text-indigo-500">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                                <h3 className="text-xl font-bold font-display">What are Protected Pipelines (PROPS)?</h3>
                            </div>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                PROPS address the systemic bottleneck of limited high-quality training data in ML development by permitting secure use of deep-web data. 
                                By filtering your telemetry before it leaves the browser, we ensure that the recommendation API never sees raw pubkeys or balancing 
                                details that could compromise your node's privacy.
                            </p>
                            <div className="flex flex-wrap gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Privacy-preserving Oracle</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Trustworthy Inference</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Adversarial Constraint</span>
                                </div>
                            </div>
                        </div>
                        <div className="w-full md:w-64 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center space-y-2">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Altruistic Objective</h4>
                            <p className="text-[11px] font-medium leading-relaxed italic" style={{ color: 'var(--text-primary)' }}>
                                "Instead of suggesting channels that only maximize personal yield, we identify liquidity gaps to heal the network graph."
                            </p>
                        </div>
                    </div>
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
    );
};

export default RecommendationsPage;
