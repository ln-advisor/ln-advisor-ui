import React, { useCallback, useMemo, useState } from 'react';
import { Buffer } from 'buffer';
import {
    ResponsiveContainer,
    BarChart, Bar,
    XAxis, YAxis,
    Tooltip, CartesianGrid, Legend,
    ScatterChart, Scatter, ZAxis,
    PieChart, Pie, Cell,
    ComposedChart, Line,
} from 'recharts';
import SectionBadge from '../components/analysis/SectionBadge';
import ErrorBanner from '../components/analysis/ErrorBanner';
import InlineSpinner from '../components/analysis/InlineSpinner';
import DataSourceLegend from '../components/analysis/DataSourceLegend';
import {
    buildFrontendTelemetryEnvelope,
    postRecommend,
    postSnapshot,
    postVerify,
    postAnalyzeGemini,
} from '../api/telemetryClient';

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

const fmtMsat = (n) => {
    const num = toNum(n);
    if (!num) return '0';
    if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T`;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return Math.round(num).toLocaleString();
};

const ageLabel = (seconds) => {
    if (!seconds || seconds < 0) return '—';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
};

const getPolicyField = (p, camel, snake, fallback = 0) => {
    if (!p) return fallback;
    if (p[camel] !== undefined) return p[camel];
    if (p[snake] !== undefined) return p[snake];
    return fallback;
};

const histogramFromBuckets = (values, buckets) => {
    const out = buckets.map((b) => ({ label: b.label, count: 0 }));
    for (const v of values) {
        const n = toNum(v);
        const idx = buckets.findIndex((b) => n >= b.min && n < b.max);
        if (idx >= 0) out[idx].count += 1;
        else out[out.length - 1].count += 1;
    }
    return out;
};

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const makeChannelRef = (index) => `channel_${String(index + 1).padStart(4, '0')}`;

const StatCard = ({ title, value, sub, color, darkMode, badge }) => (
    <div
        className="rounded-xl p-5 flex flex-col gap-2 transition-colors duration-300 relative overflow-hidden"
        style={{
            backgroundColor: 'var(--bg-card)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
            boxShadow: 'var(--card-shadow)',
        }}
    >
        <div className="h-1 w-12 rounded-full" style={{ background: color || 'var(--accent-1)' }} />
        <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                {title}
            </p>
            {badge && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: badge.bg, color: badge.text }}>
                    {badge.label}
                </span>
            )}
        </div>
        <p className="text-2xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
        {sub && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
    </div>
);

const ChartCard = ({ title, subtitle, darkMode, children, right }) => (
    <div
        className="rounded-xl overflow-hidden transition-colors duration-300"
        style={{
            backgroundColor: 'var(--bg-card)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
            boxShadow: 'var(--card-shadow)',
        }}
    >
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent-1), var(--accent-2))' }} />
        <div
            className="p-4 border-b flex items-start justify-between gap-3"
            style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}
        >
            <div>
                <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                {subtitle && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
            </div>
            {right}
        </div>
        <div className="p-5">{children}</div>
    </div>
);

const makeDownload = (filename, obj) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};



const GraphAnalysisPage = ({ lnc, darkMode }) => {
    const [graph, setGraph] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [forwardingEvents, setForwardingEvents] = useState([]);
    const [forwardingError, setForwardingError] = useState(null);
    const [rangeDays, setRangeDays] = useState(7);
    const [missionControl, setMissionControl] = useState(null);
    const [missionError, setMissionError] = useState(null);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [channels, setChannels] = useState([]);
    const [peers, setPeers] = useState([]);
    const [nodePubkey, setNodePubkey] = useState(null);
    const [nodeMetrics, setNodeMetrics] = useState(null);
    const [nodeMetricsError, setNodeMetricsError] = useState(null);
    const [includeUnannounced, setIncludeUnannounced] = useState(false);
    const [includeAuthProof, setIncludeAuthProof] = useState(false);
    const [nodeQuery, setNodeQuery] = useState('');
    const [edgeQuery, setEdgeQuery] = useState('');
    const [activeTable, setActiveTable] = useState('nodes');
    const [networkSize, setNetworkSize] = useState(36);
    const [showLabels, setShowLabels] = useState(true);
    const [focusNode, setFocusNode] = useState('');
    const [privacyMode, setPrivacyMode] = useState('feature_only');
    const [propsLoading, setPropsLoading] = useState(false);
    const [propsError, setPropsError] = useState(null);
    const [snapshotApiResult, setSnapshotApiResult] = useState(null);
    const [recommendApiResult, setRecommendApiResult] = useState(null);
    const [verifyApiResult, setVerifyApiResult] = useState(null);
    const [geminiAnalysis, setGeminiAnalysis] = useState(null);
    const [geminiLoading, setGeminiLoading] = useState(false);
    const [lastTelemetry, setLastTelemetry] = useState(null);

    const fetchGraphData = useCallback(async () => {
        if (!lnc?.lnd?.lightning) {
            setError('Lightning service not available on this LNC session.');
            return null;
        }
        if (typeof lnc.lnd.lightning.describeGraph !== 'function') {
            setError('describeGraph is not available. Ensure LNC permissions include lightning RPC: DescribeGraph.');
            return null;
        }
        try {
            const resp = await lnc.lnd.lightning.describeGraph({
                include_unannounced: includeUnannounced,
                include_auth_proof: includeAuthProof,
            });
            return resp || { nodes: [], edges: [] };
        } catch (e) {
            console.error('describeGraph failed:', e);
            setError(e?.message || 'Failed to load graph.');
        }
        return null;
    }, [lnc, includeUnannounced, includeAuthProof]);

    const fetchForwardingData = useCallback(async () => {
        if (!lnc?.lnd?.lightning) {
            setForwardingError('Lightning service not available on this LNC session.');
            return null;
        }
        if (typeof lnc.lnd.lightning.forwardingHistory !== 'function') {
            setForwardingError('forwardingHistory is not available. Ensure LNC permissions include lightning RPC: ForwardingHistory.');
            return null;
        }
        try {
            const end = Math.floor(Date.now() / 1000);
            const start = end - rangeDays * 24 * 60 * 60;
            const resp = await lnc.lnd.lightning.forwardingHistory({
                start_time: String(start),
                end_time: String(end),
                index_offset: 0,
                num_max_events: 50000,
                peer_alias_lookup: true,
            });
            const events = resp?.forwardingEvents || resp?.forwarding_events || [];
            return Array.isArray(events) ? events : [];
        } catch (e) {
            console.error('forwardingHistory failed:', e);
            setForwardingError(e?.message || 'Failed to load forwarding history.');
            return null;
        }
    }, [lnc, rangeDays]);

    const fetchMissionControlData = useCallback(async () => {
        if (!lnc?.lnd?.router) {
            setMissionError('Router service not available on this LNC session.');
            return null;
        }
        if (typeof lnc.lnd.router.queryMissionControl !== 'function') {
            setMissionError('queryMissionControl is not available. Ensure LNC permissions include router RPC: QueryMissionControl.');
            return null;
        }
        try {
            const resp = await lnc.lnd.router.queryMissionControl({});
            return resp || { pairs: [] };
        } catch (e) {
            console.error('queryMissionControl failed:', e);
            setMissionError(e?.message || 'Failed to load mission control data.');
            return null;
        }
    }, [lnc]);

    const fetchNodeMetricsData = useCallback(async () => {
        if (!lnc?.lnd?.lightning) {
            setNodeMetricsError('Lightning service not available on this LNC session.');
            return null;
        }
        if (typeof lnc.lnd.lightning.getNodeMetrics !== 'function') {
            setNodeMetricsError('getNodeMetrics is not available. Ensure LNC permissions include lightning RPC: GetNodeMetrics.');
            return null;
        }
        try {
            const resp = await lnc.lnd.lightning.getNodeMetrics({ types: ['BETWEENNESS_CENTRALITY'] });
            return resp || { betweennessCentrality: {} };
        } catch (e) {
            console.error('getNodeMetrics failed:', e);
            setNodeMetricsError(e?.message || 'Failed to load node metrics.');
            return null;
        }
    }, [lnc]);

    const fetchNodeInfo = useCallback(async () => {
        if (!lnc?.lnd?.lightning?.getInfo) return null;
        try {
            const info = await lnc.lnd.lightning.getInfo({});
            return info || null;
        } catch (e) {
            console.error('getInfo failed:', e);
            return null;
        }
    }, [lnc]);

    const fetchChannelsData = useCallback(async () => {
        if (!lnc?.lnd?.lightning?.listChannels) return [];
        try {
            const response = await lnc.lnd.lightning.listChannels({});
            return Array.isArray(response?.channels) ? response.channels : [];
        } catch (e) {
            console.error('listChannels failed:', e);
            return [];
        }
    }, [lnc]);

    const fetchPeersData = useCallback(async () => {
        if (!lnc?.lnd?.lightning?.listPeers) return [];
        try {
            const response = await lnc.lnd.lightning.listPeers({});
            return Array.isArray(response?.peers) ? response.peers : [];
        } catch (e) {
            console.error('listPeers failed:', e);
            return [];
        }
    }, [lnc]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setForwardingError(null);
        setMissionError(null);
        setNodeMetricsError(null);
        setPropsError(null);
        setSnapshotApiResult(null);
        setRecommendApiResult(null);
        setVerifyApiResult(null);
        try {
            const [graphResp, forwardingResp, missionResp, metricsResp, infoResp, channelsResp, peersResp] = await Promise.all([
                fetchGraphData(),
                fetchForwardingData(),
                fetchMissionControlData(),
                fetchNodeMetricsData(),
                fetchNodeInfo(),
                fetchChannelsData(),
                fetchPeersData(),
            ]);
            if (graphResp) setGraph(graphResp);
            if (Array.isArray(forwardingResp)) setForwardingEvents(forwardingResp);
            if (missionResp) setMissionControl(missionResp);
            if (metricsResp) setNodeMetrics(metricsResp);
            if (infoResp) {
                setNodeInfo(infoResp);
                const pubkey = infoResp?.identityPubkey || infoResp?.identity_pubkey;
                if (pubkey) setNodePubkey(String(pubkey).toLowerCase());
            }
            if (Array.isArray(channelsResp)) setChannels(channelsResp);
            if (Array.isArray(peersResp)) setPeers(peersResp);
        } finally {
            setIsLoading(false);
        }
    }, [
        fetchGraphData,
        fetchForwardingData,
        fetchMissionControlData,
        fetchNodeMetricsData,
        fetchNodeInfo,
        fetchChannelsData,
        fetchPeersData,
    ]);

    const normalized = useMemo(() => {
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
        const edges = Array.isArray(graph?.edges) ? graph.edges : [];

        const nodeByPub = new Map();
        nodes.forEach((n) => {
            const pub = String(n.pub_key || n.pubKey || '').toLowerCase();
            if (!pub) return;
            nodeByPub.set(pub, {
                pub_key: pub,
                alias: n.alias || '',
                color: n.color || '',
                last_update: toNum(n.last_update ?? n.lastUpdate ?? 0),
            });
        });

        const statsByNode = new Map();
        const ensure = (pub) => {
            if (!statsByNode.has(pub)) {
                const meta = nodeByPub.get(pub) || {};
                statsByNode.set(pub, {
                    pub_key: pub,
                    alias: meta.alias || '',
                    color: meta.color || '',
                    channels: 0,
                    adjacentCapacity: 0,
                });
            }
            return statsByNode.get(pub);
        };

        let totalCapacity = 0;

        edges.forEach((e) => {
            const n1 = String(e.node1_pub || e.node1Pub || '').toLowerCase();
            const n2 = String(e.node2_pub || e.node2Pub || '').toLowerCase();
            const cap = toNum(e.capacity);

            if (cap > 0) totalCapacity += cap;

            if (n1) {
                const s1 = ensure(n1);
                s1.channels += 1;
                s1.adjacentCapacity += cap;
            }
            if (n2) {
                const s2 = ensure(n2);
                s2.channels += 1;
                s2.adjacentCapacity += cap;
            }


        });

        const channelById = new Map();
        edges.forEach((e) => {
            const chanId = String(e.channel_id || e.channelId || '');
            if (!chanId) return;
            const n1 = String(e.node1_pub || e.node1Pub || '').toLowerCase();
            const n2 = String(e.node2_pub || e.node2Pub || '').toLowerCase();
            channelById.set(chanId, {
                n1,
                n2,
                a1: nodeByPub.get(n1)?.alias || '',
                a2: nodeByPub.get(n2)?.alias || '',
            });
        });

        const nodeStats = Array.from(statsByNode.values());
        nodeStats.sort((a, b) => b.channels - a.channels || b.adjacentCapacity - a.adjacentCapacity);

        return { nodes, edges, nodeByPub, nodeStats, totalCapacity, channelById };
    }, [graph]);

    const forwardingSummary = useMemo(() => {
        const events = Array.isArray(forwardingEvents) ? forwardingEvents : [];
        let totalFeeSat = 0;
        let totalAmtInSat = 0;
        let totalAmtOutSat = 0;
        const byChan = new Map();

        const toSat = (v) => {
            const n = toNum(v);
            return n;
        };
        const tsToMs = (e) => {
            const ns = toNum(e.timestampNs ?? e.timestamp_ns ?? 0);
            if (ns) return Math.floor(ns / 1_000_000);
            const sec = toNum(e.timestamp ?? 0);
            return sec ? sec * 1000 : 0;
        };

        events.forEach((e) => {
            const chanIn = String(e.chanIdIn || e.chan_id_in || '');
            const chanOut = String(e.chanIdOut || e.chan_id_out || '');
            const feeSat = toSat(e.fee ?? e.feeSat ?? 0);
            const amtIn = toSat(e.amtIn ?? e.amtInSat ?? 0);
            const amtOut = toSat(e.amtOut ?? e.amtOutSat ?? 0);
            const ts = tsToMs(e);

            totalFeeSat += feeSat;
            totalAmtInSat += amtIn;
            totalAmtOutSat += amtOut;

            const upsert = (chanId, direction) => {
                if (!chanId) return;
                if (!byChan.has(chanId)) {
                    byChan.set(chanId, { chanId, count: 0, feeSat: 0, amtInSat: 0, amtOutSat: 0, lastTs: 0, direction });
                }
                const row = byChan.get(chanId);
                row.count += 1;
                row.feeSat += feeSat;
                row.amtInSat += amtIn;
                row.amtOutSat += amtOut;
                row.lastTs = Math.max(row.lastTs, ts);
            };

            upsert(chanIn, 'in');
            upsert(chanOut, 'out');
        });

        const rows = Array.from(byChan.values());
        rows.sort((a, b) => b.feeSat - a.feeSat || b.count - a.count);

        return {
            total: events.length,
            totalFeeSat,
            totalAmtInSat,
            totalAmtOutSat,
            topRows: rows.slice(0, 12),
        };
    }, [forwardingEvents]);

    const missionSummary = useMemo(() => {
        const bytesToHex = (value) => {
            if (!value) return '';
            try {
                if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
                if (typeof value === 'string') {
                    const v = value.trim().toLowerCase();
                    if (/^[0-9a-f]+$/.test(v)) return v;
                    return Buffer.from(value, 'base64').toString('hex');
                }
            } catch (err) {
                console.warn('bytesToHex failed:', err);
            }
            return '';
        };

        const pairs = Array.isArray(missionControl?.pairs) ? missionControl.pairs : [];
        const now = Date.now() / 1000;
        
        let validPairs = pairs.map(p => ({
            raw: p,
            from: bytesToHex(p.node_from || p.nodeFrom),
            to: bytesToHex(p.node_to || p.nodeTo)
        }));
        
        if (nodePubkey) {
            validPairs = validPairs.filter(p => p.from !== nodePubkey && p.to !== nodePubkey);
        }

        const normPairs = validPairs.map((vp) => {
            const { raw: p, from, to } = vp;
            const h = p.history || p.pairHistory || {};
            const failTime = toNum(h.fail_time ?? h.failTime);
            const successTime = toNum(h.success_time ?? h.successTime);
            const failAmtSat = toNum(h.fail_amt_sat ?? h.failAmtSat);
            const successAmtSat = toNum(h.success_amt_sat ?? h.successAmtSat);
            const failAmtMsat = toNum(h.fail_amt_msat ?? h.failAmtMsat) || (failAmtSat ? failAmtSat * 1000 : 0);
            const successAmtMsat = toNum(h.success_amt_msat ?? h.successAmtMsat) || (successAmtSat ? successAmtSat * 1000 : 0);
            const successAge = successTime ? Math.max(0, now - successTime) : 0;
            const failAge = failTime ? Math.max(0, now - failTime) : 0;
            const successWeight = successAmtMsat ? Math.log10(successAmtMsat + 1) : 0;
            const failWeight = failAmtMsat ? Math.log10(failAmtMsat + 1) : 0;
            const successScore = successTime ? (1 / (1 + successAge / 86400)) * successWeight : 0;
            const failPenalty = failTime ? (1 / (1 + failAge / 86400)) * failWeight : 0;
            const score = successScore - failPenalty * 0.6;
            return {
                from,
                to,
                failTime,
                successTime,
                failAmtSat,
                successAmtSat,
                failAmtMsat,
                successAmtMsat,
                successAge,
                failAge,
                score,
            };
        });

        const total = normPairs.length;
        const withSuccess = normPairs.filter((p) => p.successTime > 0).length;
        const withFail = normPairs.filter((p) => p.failTime > 0).length;
        const recentSuccess = normPairs.filter((p) => p.successAge && p.successAge <= 7 * 86400).length;
        const recentFail = normPairs.filter((p) => p.failAge && p.failAge <= 7 * 86400).length;

        const recencyBuckets = [
            { label: '≤1h', max: 3600 },
            { label: '≤24h', max: 86400 },
            { label: '≤7d', max: 7 * 86400 },
            { label: '≤30d', max: 30 * 86400 },
            { label: '>30d', max: Number.POSITIVE_INFINITY },
        ];
        const recencyData = recencyBuckets.map((b) => ({ label: b.label, success: 0, fail: 0 }));
        normPairs.forEach((p) => {
            if (p.successAge) {
                const i = recencyBuckets.findIndex((b) => p.successAge <= b.max);
                if (i >= 0) recencyData[i].success += 1;
            }
            if (p.failAge) {
                const i = recencyBuckets.findIndex((b) => p.failAge <= b.max);
                if (i >= 0) recencyData[i].fail += 1;
            }
        });

        let successOnly = 0;
        let failOnly = 0;
        let both = 0;
        let none = 0;
        normPairs.forEach((p) => {
            const s = p.successTime > 0;
            const f = p.failTime > 0;
            if (s && f) both += 1;
            else if (s) successOnly += 1;
            else if (f) failOnly += 1;
            else none += 1;
        });
        const statusPie = [
            { name: 'Success only', value: successOnly, color: 'var(--accent-1)' },
            { name: 'Fail only', value: failOnly, color: 'var(--accent-3)' },
            { name: 'Both', value: both, color: 'var(--accent-2)' },
            { name: 'No data', value: none, color: '#94a3b8' },
        ];

        const scatterData = [];
        const step = Math.max(1, Math.floor(normPairs.length / 500));
        for (let i = 0; i < normPairs.length; i += step) {
            const p = normPairs[i];
            scatterData.push({
                success: Math.round(p.successAmtMsat / 1000),
                fail: Math.round(p.failAmtMsat / 1000),
            });
        }

        const byScoreDesc = [...normPairs].sort((a, b) => b.score - a.score);
        const byScoreAsc = [...normPairs].sort((a, b) => a.score - b.score);
        const topPairs = byScoreDesc.slice(0, 12);
        const lowPairs = byScoreAsc.slice(0, 12);
        const topPairsTable = byScoreDesc.slice(0, 200);

        return {
            total,
            withSuccess,
            withFail,
            recentSuccess,
            recentFail,
            recencyData,
            statusPie,
            scatterData,
            topPairs,
            lowPairs,
            topPairsTable,
        };
    }, [missionControl, nodePubkey]);

    const nodeMetricsSummary = useMemo(() => {
        const entries = nodeMetrics?.betweennessCentrality || nodeMetrics?.betweenness_centrality || {};
        const list = Object.entries(entries).map(([key, value]) => ({
            pub: String(key || '').toLowerCase(),
            value: toNum(value?.value ?? value?.normalizedValue ?? value?.normalized_value ?? 0),
            normalized: toNum(value?.normalizedValue ?? value?.normalized_value ?? 0),
        }));
        list.sort((a, b) => b.normalized - a.normalized);
        return list.slice(0, 15);
    }, [nodeMetrics]);

    const kpis = useMemo(() => {
        const nodeCount = normalized.nodes.length;
        const edgeCount = normalized.edges.length;
        const cap = normalized.totalCapacity;
        const avgCap = edgeCount ? cap / edgeCount : 0;
        return { nodeCount, edgeCount, cap, avgCap };
    }, [normalized]);

    const chartTheme = useMemo(() => {
        const axis = darkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
        const grid = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const tooltipBg = darkMode ? '#0b1220' : '#ffffff';
        const tooltipBorder = darkMode ? '#334155' : '#e5e7eb';
        return { axis, grid, tooltipBg, tooltipBorder };
    }, [darkMode]);

    // ── Chart data ────────────────────────────────────────────────────────
    const topNodesByDegree = useMemo(() =>
        normalized.nodeStats.slice(0, 15).map((n) => ({
            label: n.alias || shortHex(n.pub_key, 12),
            channels: n.channels,
            capacity: Math.round(n.adjacentCapacity / 1_000_000), // in M sats
        })), [normalized.nodeStats]);



    const network = useMemo(() => {
        const maxNodes = Math.max(8, Math.min(networkSize, normalized.nodeStats.length));
        const nodes = normalized.nodeStats.slice(0, maxNodes);
        const nodeSet = new Set(nodes.map(n => n.pub_key));

        const width = 900;
        const height = 520;
        const center = { x: width / 2, y: height / 2 };
        const ring1Count = Math.min(10, nodes.length);
        const ring2Count = Math.min(14, Math.max(0, nodes.length - ring1Count));
        const ring3Count = Math.max(0, nodes.length - ring1Count - ring2Count);

        const ring1 = nodes.slice(0, ring1Count);
        const ring2 = nodes.slice(ring1Count, ring1Count + ring2Count);
        const ring3 = nodes.slice(ring1Count + ring2Count, ring1Count + ring2Count + ring3Count);

        const placeRing = (ringNodes, radius) => ringNodes.map((n, i) => {
            const angle = (2 * Math.PI * i) / Math.max(1, ringNodes.length);
            return {
                ...n,
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius,
            };
        });

        const arranged = [
            ...placeRing(ring1, 120),
            ...placeRing(ring2, 200),
            ...placeRing(ring3, 280),
        ];

        const posByPub = new Map(arranged.map(n => [n.pub_key, n]));
        let edges = normalized.edges.filter((e) => {
            const n1 = String(e.node1_pub || e.node1Pub || '').toLowerCase();
            const n2 = String(e.node2_pub || e.node2Pub || '').toLowerCase();
            return nodeSet.has(n1) && nodeSet.has(n2);
        }).map((e, idx) => ({
            id: e.channel_id || e.channelId || String(idx),
            n1: String(e.node1_pub || e.node1Pub || '').toLowerCase(),
            n2: String(e.node2_pub || e.node2Pub || '').toLowerCase(),
            cap: toNum(e.capacity),
        }));

        if (edges.length > 1200) {
            const step = Math.ceil(edges.length / 1200);
            edges = edges.filter((_, i) => i % step === 0);
        }

        const maxCap = Math.max(...edges.map(e => e.cap), 1);
        return { nodes: arranged, edges, width, height, maxCap, posByPub };
    }, [normalized.edges, normalized.nodeStats, networkSize]);

    const focusNeighbors = useMemo(() => {
        if (!focusNode) return null;
        const set = new Set([focusNode]);
        network.edges.forEach((e) => {
            if (e.n1 === focusNode) set.add(e.n2);
            if (e.n2 === focusNode) set.add(e.n1);
        });
        return set;
    }, [focusNode, network.edges]);

    const thStyle = useMemo(() => ({
        padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
        whiteSpace: 'nowrap',
    }), [darkMode]);

    const tdStyle = useMemo(() => ({
        padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
        whiteSpace: 'nowrap',
    }), [darkMode]);

    const tabStyle = useCallback((isActive) => ({
        borderColor: isActive ? 'var(--accent-2)' : 'transparent',
        color: isActive ? 'var(--accent-2)' : 'var(--text-secondary)',
    }), []);

    const filteredNodes = useMemo(() => {
        const q = nodeQuery.trim().toLowerCase();
        if (!q) return normalized.nodeStats.slice(0, 200);
        return normalized.nodeStats.filter(n =>
            (n.alias || '').toLowerCase().includes(q) || (n.pub_key || '').toLowerCase().includes(q)
        ).slice(0, 200);
    }, [normalized.nodeStats, nodeQuery]);

    const filteredEdges = useMemo(() => {
        const edges = Array.isArray(normalized.edges) ? normalized.edges : [];
        const q = edgeQuery.trim().toLowerCase();
        const withAliases = edges.map((e) => {
            const n1 = String(e.node1_pub || e.node1Pub || '').toLowerCase();
            const n2 = String(e.node2_pub || e.node2Pub || '').toLowerCase();
            const a1 = normalized.nodeByPub.get(n1)?.alias || '';
            const a2 = normalized.nodeByPub.get(n2)?.alias || '';
            return { e, n1, n2, a1, a2 };
        });
        const sorted = withAliases.sort((a, b) => toNum(b.e.capacity) - toNum(a.e.capacity));
        const filtered = q ? sorted.filter(x =>
            String(x.e.channel_id || x.e.channelId || '').toLowerCase().includes(q) ||
            x.n1.includes(q) || x.n2.includes(q) ||
            x.a1.toLowerCase().includes(q) || x.a2.toLowerCase().includes(q)
        ) : sorted;
        return filtered.slice(0, 200);
    }, [normalized.edges, normalized.nodeByPub, edgeQuery]);

    const channelRefToChanId = useMemo(() => {
        const ids = [...channels]
            .map((channel) => String(channel?.chanId || channel?.chan_id || channel?.channelId || '').trim())
            .filter(Boolean)
            .sort(compareText);
        const map = new Map();
        ids.forEach((channelId, index) => {
            map.set(makeChannelRef(index), channelId);
        });
        return map;
    }, [channels]);

    const propsSummary = useMemo(() => {
        const recommendation = recommendApiResult?.recommendation;
        const feeRows = Array.isArray(recommendation?.feeRecommendations) ? recommendation.feeRecommendations : [];
        const rankingRows = Array.isArray(recommendation?.forwardOpportunityRanking) ? recommendation.forwardOpportunityRanking : [];
        const verifyOk = Boolean(verifyApiResult?.ok);
        return {
            verifyOk,
            errors: Array.isArray(verifyApiResult?.errors) ? verifyApiResult.errors : [],
            warnings: Array.isArray(verifyApiResult?.warnings) ? verifyApiResult.warnings : [],
            feeRows: feeRows.slice(0, 10),
            rankingRows: rankingRows.slice(0, 10),
        };
    }, [recommendApiResult, verifyApiResult]);

    const runAnalysisPipeline = useCallback(async () => {
        if (!graph) {
            setPropsError('Fetch data first, then run the analysis pipeline.');
            return;
        }

        setPropsLoading(true);
        setPropsError(null);
        setVerifyApiResult(null);
        setGeminiAnalysis(null);
        setGeminiLoading(false);

        try {
            const telemetry = buildFrontendTelemetryEnvelope({
                namespace: 'tapvolt',
                nodeInfo: nodeInfo || (nodePubkey ? { identityPubkey: nodePubkey } : null),
                channels,
                forwardingHistory: forwardingEvents,
                routingFailures: [],
                peers,
                graphSnapshot: {
                    fetchedAt: new Date().toISOString(),
                    includeUnannounced,
                    includeAuthProof,
                    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
                    edges: Array.isArray(graph?.edges) ? graph.edges : [],
                },
                missionControl: missionControl || { pairs: [] },
                nodeMetrics: nodeMetrics || { betweennessCentrality: {} },
            });
            setLastTelemetry(telemetry);

            const snapshotResponse = await postSnapshot(telemetry);
            setSnapshotApiResult(snapshotResponse);

            const recommendResponse = await postRecommend({
                telemetry,
                privacyMode,
            });
            setRecommendApiResult(recommendResponse);

            const verifyResponse = await postVerify(
                recommendResponse?.arb,
                recommendResponse?.sourceProvenance
            );
            setVerifyApiResult(verifyResponse);
        } catch (e) {
            console.error('Analysis failed:', e);
            setPropsError(e?.message || 'Analysis request failed.');
        } finally {
            setPropsLoading(false);
        }
    }, [
        graph,
        nodeInfo,
        nodePubkey,
        channels,
        forwardingEvents,
        peers,
        includeUnannounced,
        includeAuthProof,
        missionControl,
        nodeMetrics,
    ]);

    return (
        <div className="px-6 pb-10 pt-8 space-y-8" style={{ maxWidth: 1280, margin: '0 auto' }}>
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <div className="flex flex-col gap-3">
                        <h2 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--text-primary)' }}>
                            Node &amp; Network Analysis
                        </h2>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest"
                            style={{ color: 'var(--text-secondary)' }}>
                            <SectionBadge label="Public Data" variant="public" />
                            <SectionBadge label="Private Data" variant="private" />
                        </div>
                        <DataSourceLegend
                            publicSources={['describeGraph', 'getNodeMetrics']}
                            privateSources={['forwardingHistory', 'queryMissionControl']}
                        />
                    </div>
                    <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                        Live read-only analysis of your node’s network position, forwarding performance,
                        and routing intelligence. Data is fetched directly from your node via LNC —
                        no external API calls are made from this page.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchData}
                        disabled={isLoading}
                        style={{
                            padding: '10px 20px',
                            borderRadius: 12,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            border: 'none',
                            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
                            color: '#fff',
                            boxShadow: darkMode ? '0 8px 18px rgba(34,211,238,0.25)' : '0 8px 18px rgba(37,99,235,0.2)',
                            opacity: isLoading ? 0.65 : 1,
                            transition: 'opacity 0.2s',
                        }}
                    >
                        {isLoading ? 'Loading…' : 'Fetch Data'}
                    </button>
                    {isLoading && <InlineSpinner label="Fetching graph + signals…" />}
                    {!isLoading && graph && (
                        <span
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold"
                            style={{
                                background: darkMode ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.12)',
                                color: darkMode ? '#4ade80' : '#166534',
                                border: `1px solid ${darkMode ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.2)'}`,
                            }}
                        >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                            Data Loaded
                        </span>
                    )}
                </div>
            </div>

            <ErrorBanner message={error} />
            <ErrorBanner message={forwardingError} />
            <ErrorBanner message={missionError} />
            <ErrorBanner message={nodeMetricsError} />

            {!graph && !isLoading && !error && (
                <div className="rounded-xl p-8 text-sm text-center" style={{ backgroundColor: 'var(--form-bg)', color: 'var(--text-secondary)' }}>
                    <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                        Ready When You Are
                    </div>
                    <p>Click <span className="font-semibold" style={{ color: 'var(--accent-2)' }}>Fetch Data</span> to load the Lightning network snapshot and forwarding history from your node.</p>
                </div>
            )}

            {graph && (
                <>
                    <ChartCard
                        title="Analysis Summary"
                        subtitle="Local telemetry to reduced request, analysis, and signed result"
                        darkMode={darkMode}
                        right={
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{
                                    background: propsSummary.verifyOk ? 'rgba(34,197,94,0.16)' : 'rgba(148,163,184,0.18)',
                                    color: propsSummary.verifyOk ? '#22c55e' : 'var(--text-secondary)',
                                }}>
                                {propsSummary.verifyOk ? 'Verified' : 'Not verified'}
                            </span>
                        }
                    >
                        {!recommendApiResult ? (
                            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                Run <span className="font-semibold" style={{ color: 'var(--accent-2)' }}>Analysis</span> after
                                fetching data to generate verified recommendations.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <StatCard
                                        title="Snapshot Mode"
                                        value={String(snapshotApiResult?.mode || recommendApiResult?.mode || 'unknown')}
                                        darkMode={darkMode}
                                        color="var(--accent-2)"
                                    />
                                    <StatCard
                                        title="Privacy Mode"
                                        value={String(recommendApiResult?.privacyMode || 'unknown')}
                                        darkMode={darkMode}
                                        color="var(--accent-3)"
                                        sub={`ARB policy ${String(recommendApiResult?.arb?.privacyPolicyId || 'unknown')}`}
                                    />
                                    <StatCard
                                        title="Fee Recs"
                                        value={String(recommendApiResult?.recommendation?.feeRecommendations?.length || 0)}
                                        darkMode={darkMode}
                                        color="var(--accent-1)"
                                    />
                                    <StatCard
                                        title="Ranked Channels"
                                        value={String(recommendApiResult?.recommendation?.forwardOpportunityRanking?.length || 0)}
                                        darkMode={darkMode}
                                        color="var(--accent-4)"
                                    />
                                </div>

                                {propsSummary.warnings.length > 0 && (
                                    <div className="rounded-lg p-3 text-xs"
                                        style={{
                                            backgroundColor: darkMode ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.18)',
                                            color: darkMode ? '#fef08a' : '#854d0e',
                                        }}>
                                        {propsSummary.warnings.join(' | ')}
                                    </div>
                                )}

                                {propsSummary.errors.length > 0 && (
                                    <div className="rounded-lg p-3 text-xs"
                                        style={{
                                            backgroundColor: darkMode ? 'rgba(251,113,133,0.12)' : 'rgba(244,63,94,0.12)',
                                            color: darkMode ? '#fda4af' : '#9f1239',
                                        }}>
                                        {propsSummary.errors.join(' | ')}
                                    </div>
                                )}

                                <div className="grid lg:grid-cols-2 gap-4">
                                    <div style={{ overflowX: 'auto' }}>
                                        <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                            Fee Recommendations
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr>
                                                    <th style={thStyle}>Channel Ref</th>
                                                    <th style={thStyle}>Mapped ChanId</th>
                                                    <th style={thStyle}>Action</th>
                                                    <th style={thStyle}>Suggested PPM</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {propsSummary.feeRows.length === 0 ? (
                                                    <tr>
                                                        <td style={tdStyle} colSpan={4}>No fee recommendations.</td>
                                                    </tr>
                                                ) : propsSummary.feeRows.map((row) => (
                                                    <tr key={`${row.channelRef}-${row.peerRef}`}>
                                                        <td style={tdStyle}><span style={{ fontFamily: 'monospace' }}>{row.channelRef}</span></td>
                                                        <td style={tdStyle}><span style={{ fontFamily: 'monospace' }}>{channelRefToChanId.get(row.channelRef) || 'unresolved'}</span></td>
                                                        <td style={tdStyle}>{row.action}</td>
                                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{row.suggestedFeePpm ?? 'n/a'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{ overflowX: 'auto' }}>
                                        <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                            Forward Opportunity Ranking
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr>
                                                    <th style={thStyle}>Rank</th>
                                                    <th style={thStyle}>Channel Ref</th>
                                                    <th style={thStyle}>Mapped ChanId</th>
                                                    <th style={thStyle}>Score</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {propsSummary.rankingRows.length === 0 ? (
                                                    <tr>
                                                        <td style={tdStyle} colSpan={4}>No ranking rows.</td>
                                                    </tr>
                                                ) : propsSummary.rankingRows.map((row) => (
                                                    <tr key={`${row.rank}-${row.channelRef}-${row.peerRef}`}>
                                                        <td style={tdStyle}>{row.rank}</td>
                                                        <td style={tdStyle}><span style={{ fontFamily: 'monospace' }}>{row.channelRef}</span></td>
                                                        <td style={tdStyle}><span style={{ fontFamily: 'monospace' }}>{channelRefToChanId.get(row.channelRef) || 'unresolved'}</span></td>
                                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{row.score}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Gemini Analysis Section */}
                                <div className="pt-6 border-t border-white/10 mt-6">
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
                                                        const gRes = await postAnalyzeGemini(lastTelemetry, recommendApiResult?.recommendation);
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
                                            Click "Verify with AI" to get an intelligent second opinion on the network recommendations.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </ChartCard>

                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Nodes" value={kpis.nodeCount.toLocaleString()} darkMode={darkMode} color="var(--accent-2)" />
                        <StatCard title="Channels" value={kpis.edgeCount.toLocaleString()} darkMode={darkMode} color="var(--accent-1)" />
                        <StatCard title="Total Capacity" value={`${fmtSats(kpis.cap)} sats`} darkMode={darkMode} color="var(--accent-3)"
                            sub={`Avg ${fmtSats(kpis.avgCap)} sats / channel`} />
                        
                    </div>

                    <ChartCard
                        title="Peer + channel map"
                        subtitle="Topology view of the most connected nodes (not to scale)"
                        darkMode={darkMode}
                        right={
                            <div className="flex items-center gap-2">
                                <select
                                    value={networkSize}
                                    onChange={(e) => setNetworkSize(Number(e.target.value))}
                                    className="px-2 py-1.5 rounded-lg text-xs"
                                    style={{
                                        backgroundColor: 'var(--input-bg)',
                                        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                                        color: 'var(--text-primary)',
                                    }}
                                >
                                    <option value={24}>24 nodes</option>
                                    <option value={36}>36 nodes</option>
                                    <option value={48}>48 nodes</option>
                                    <option value={60}>60 nodes</option>
                                </select>
                                <label className="text-xs flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"
                                    style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)' }}>
                                    <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                                    labels
                                </label>
                            </div>
                        }
                    >
                        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
                            <div style={{ width: '100%', height: 460 }}>
                                <svg viewBox={`0 0 ${network.width} ${network.height}`} width="100%" height="100%">
                                    <defs>
                                        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
                                            <stop offset="0%" stopColor="rgba(99,102,241,0.7)" />
                                            <stop offset="100%" stopColor="rgba(99,102,241,0.05)" />
                                        </radialGradient>
                                    </defs>
                                    <rect width="100%" height="100%" fill="transparent" />
                                    {network.edges.map((e) => {
                                        const n1 = network.posByPub.get(e.n1);
                                        const n2 = network.posByPub.get(e.n2);
                                        if (!n1 || !n2) return null;
                                        const isActive = focusNode && (e.n1 === focusNode || e.n2 === focusNode);
                                        const isDim = focusNode && !isActive;
                                        const width = 0.6 + (e.cap / network.maxCap) * 2.2;
                                        return (
                                            <line
                                                key={`${e.id}-${e.n1}-${e.n2}`}
                                                x1={n1.x}
                                                y1={n1.y}
                                                x2={n2.x}
                                                y2={n2.y}
                                                stroke={isActive ? 'var(--accent-2)' : '#94a3b8'}
                                                strokeOpacity={isDim ? 0.08 : isActive ? 0.6 : 0.25}
                                                strokeWidth={width}
                                            />
                                        );
                                    })}

                                    {network.nodes.map((n) => {
                                        const isFocused = focusNode === n.pub_key;
                                        const isConnected = focusNeighbors ? focusNeighbors.has(n.pub_key) : true;
                                        const r = 4 + Math.min(10, Math.log2(n.channels + 1));
                                        return (
                                            <g key={n.pub_key} onMouseEnter={() => setFocusNode(n.pub_key)} onMouseLeave={() => setFocusNode('')}>
                                                <circle cx={n.x} cy={n.y} r={r * 2.2} fill="url(#nodeGlow)" opacity={isFocused ? 0.6 : 0.3} />
                                                <circle
                                                    cx={n.x}
                                                    cy={n.y}
                                                    r={r}
                                                    fill={isFocused ? 'var(--accent-2)' : 'var(--accent-1)'}
                                                    fillOpacity={isConnected ? 0.95 : 0.25}
                                                    stroke="#0f172a"
                                                    strokeOpacity={darkMode ? 0.5 : 0.15}
                                                />
                                                {showLabels && (
                                                    <text
                                                        x={n.x}
                                                        y={n.y - r - 6}
                                                        textAnchor="middle"
                                                        fontSize="10"
                                                        fill={darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.65)'}
                                                    >
                                                        {n.alias || shortHex(n.pub_key, 8)}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            </div>
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg p-3" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                                    <p className="text-xs uppercase font-semibold tracking-widest" style={{ color: 'var(--text-secondary)' }}>Focus</p>
                                    {focusNode ? (
                                        <>
                                            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {normalized.nodeByPub.get(focusNode)?.alias || 'Unknown'}
                                            </p>
                                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                                {shortHex(focusNode, 22)}
                                            </p>
                                        </>
                                    ) : (
                                        <p style={{ color: 'var(--text-secondary)' }}>Hover a node to inspect its neighborhood.</p>
                                    )}
                                </div>
                                {focusNode && (
                                    <div className="rounded-lg p-3" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                                        <p className="text-xs uppercase font-semibold tracking-widest" style={{ color: 'var(--text-secondary)' }}>Connections</p>
                                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                            {(focusNeighbors?.size || 1) - 1} adjacent nodes
                                        </p>
                                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                            Use this to visually spot hubs and clusters for targeted channel strategy.
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-lg p-3" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                                    <p className="text-xs uppercase font-semibold tracking-widest" style={{ color: 'var(--text-secondary)' }}>Legend</p>
                                    <div className="mt-2 space-y-1">
                                        <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent-1)' }} /><span>Node (size = degree)</span></div>
                                        <div className="flex items-center gap-2"><span className="inline-block w-3 h-0.5" style={{ background: '#94a3b8' }} /><span>Channel (thickness = capacity)</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ChartCard>

                    {/* Forwarding intelligence */}
                    <ChartCard
                        title="Forwarding Intelligence"
                        subtitle={`Private forwarding history · last ${rangeDays} days`}
                        darkMode={darkMode}
                        right={
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent-2)' }}>
                                Private Data
                            </span>
                        }
                    >
                        {forwardingEvents.length === 0 ? (
                            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                No forwarding events returned for this window.
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                    <StatCard title="Forwards" value={forwardingSummary.total.toLocaleString()} darkMode={darkMode} color="var(--accent-2)" />
                                    <StatCard title="Fees Earned" value={`${fmtSats(forwardingSummary.totalFeeSat)} sats`} darkMode={darkMode} color="var(--accent-1)" />
                                    <StatCard title="Volume" value={`${fmtSats(forwardingSummary.totalAmtInSat)} sats`} darkMode={darkMode} color="var(--accent-3)" />
                                </div>
                                <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    Top channels by fee (mapped to graph)
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>
                                                <th style={thStyle}>Channel</th>
                                                <th style={thStyle}>Direction</th>
                                                <th style={thStyle}>Forwards</th>
                                                <th style={thStyle}>Fees</th>
                                                <th style={thStyle}>Avg Fee</th>
                                                <th style={thStyle}>Last Seen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {forwardingSummary.topRows.map((row) => {
                                                const meta = normalized.channelById.get(row.chanId);
                                                const label = meta
                                                    ? `${meta.a1 || shortHex(meta.n1, 10)} ↔ ${meta.a2 || shortHex(meta.n2, 10)}`
                                                    : shortHex(row.chanId, 16);
                                                const lastSeen = row.lastTs ? new Date(row.lastTs).toLocaleString() : '—';
                                                const avgFee = row.count ? Math.round(row.feeSat / row.count) : 0;
                                                return (
                                                    <tr key={`${row.chanId}-${row.direction}`}>
                                                        <td style={{ ...tdStyle, fontWeight: 600 }}>{label}</td>
                                                        <td style={tdStyle}>{row.direction === 'in' ? 'Inbound' : 'Outbound'}</td>
                                                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.count.toLocaleString()}</td>
                                                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtSats(row.feeSat)} sats</td>
                                                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{avgFee.toLocaleString()} sats</td>
                                                        <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{lastSeen}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </ChartCard>

                    <ChartCard
                        title="Mission Control Intelligence"
                        subtitle="Path reliability signals from router history"
                        darkMode={darkMode}
                        right={
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent-2)' }}>
                                Private Data
                            </span>
                        }
                    >
                        {!missionControl ? (
                            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                Mission control data not available yet.
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <StatCard title="Pairs tracked" value={missionSummary.total.toLocaleString()} color="var(--accent-2)" darkMode={darkMode} />
                                    <StatCard title="Pairs with success" value={missionSummary.withSuccess.toLocaleString()} color="var(--accent-1)" darkMode={darkMode} sub={`${missionSummary.recentSuccess} in 7d`} />
                                    <StatCard title="Pairs with failure" value={missionSummary.withFail.toLocaleString()} color="var(--accent-3)" darkMode={darkMode} sub={`${missionSummary.recentFail} in 7d`} />
                                    <StatCard title="Signal balance" value={`${missionSummary.withSuccess + missionSummary.withFail}`} color="var(--accent-4)" darkMode={darkMode} sub="Success + fail pairs" />
                                </div>
                            </div>
                        )}
                    </ChartCard>

                    {missionControl && (
                        <div className="grid lg:grid-cols-2 gap-4">
                            <ChartCard
                                title="Recency distribution"
                                subtitle="How fresh are success and failure signals?"
                                darkMode={darkMode}
                            >
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={missionSummary.recencyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                            <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                            <YAxis tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                labelStyle={{ color: 'var(--text-secondary)' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                                            <Bar dataKey="success" fill="var(--accent-1)" radius={[6, 6, 0, 0]} name="Success" />
                                            <Bar dataKey="fail" fill="var(--accent-3)" radius={[6, 6, 0, 0]} name="Failure" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </ChartCard>

                            <ChartCard
                                title="Signal coverage"
                                subtitle="What share of pairs have success/failure history?"
                                darkMode={darkMode}
                            >
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-center">
                                    <div style={{ width: '100%', height: 260 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={missionSummary.statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                                                    {missionSummary.statusPie.map((entry) => (
                                                        <Cell key={entry.name} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        {missionSummary.statusPie.map((row) => (
                                            <div key={row.name} className="flex items-center justify-between">
                                                <span className="flex items-center gap-2">
                                                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                                                    {row.name}
                                                </span>
                                                <span style={{ color: 'var(--text-secondary)' }}>{row.value.toLocaleString()}</span>
                                            </div>
                                        ))}
                                        <p className="text-xs mt-4" style={{ color: 'var(--text-secondary)' }}>
                                            Use this view to gauge how rich mission control history is before scoring peers.
                                        </p>
                                    </div>
                                </div>
                            </ChartCard>
                        </div>
                    )}

                    {missionControl && (
                        <div className="grid lg:grid-cols-2 gap-4">
                            <ChartCard
                                title="Success vs failure amounts"
                                subtitle="Each dot = one pair history (k sats)"
                                darkMode={darkMode}
                            >
                                {missionSummary.scatterData.length === 0 ? (
                                    <div className="text-sm h-64 flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>No data.</div>
                                ) : (
                                    <div style={{ width: '100%', height: 300 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                                                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                                <XAxis dataKey="success" name="Success (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                                                <YAxis dataKey="fail" name="Fail (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                                                <Tooltip
                                                    cursor={{ strokeDasharray: '3 3' }}
                                                    contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                    formatter={(v, name) => [`${v.toLocaleString()} k sats`, name]}
                                                />
                                                <Scatter data={missionSummary.scatterData} fill="var(--accent-2)" fillOpacity={0.6} />
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </ChartCard>

                            <ChartCard
                                title="Top + weak pairs"
                                subtitle="Score blends success recency and failure penalty"
                                darkMode={darkMode}
                            >
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                            Strong pairs
                                        </div>
                                        <div className="space-y-2">
                                            {missionSummary.topPairs.map((row) => {
                                                const fromAlias = normalized.nodeByPub.get(row.from)?.alias || shortHex(row.from, 10);
                                                const toAlias = normalized.nodeByPub.get(row.to)?.alias || shortHex(row.to, 10);
                                                return (
                                                    <div key={`${row.from}-${row.to}`} className="flex items-center justify-between text-sm">
                                                        <span>{fromAlias} → {toAlias}</span>
                                                        <span className="font-mono" style={{ color: 'var(--accent-1)' }}>{row.score.toFixed(2)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                            Weak pairs
                                        </div>
                                        <div className="space-y-2">
                                            {missionSummary.lowPairs.map((row) => {
                                                const fromAlias = normalized.nodeByPub.get(row.from)?.alias || shortHex(row.from, 10);
                                                const toAlias = normalized.nodeByPub.get(row.to)?.alias || shortHex(row.to, 10);
                                                return (
                                                    <div key={`${row.from}-${row.to}`} className="flex items-center justify-between text-sm">
                                                        <span>{fromAlias} → {toAlias}</span>
                                                        <span className="font-mono" style={{ color: 'var(--accent-4)' }}>{row.score.toFixed(2)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </ChartCard>
                        </div>
                    )}

                    <ChartCard
                        title="Graph Influence (Betweenness Centrality)"
                        subtitle="Public graph signal · top nodes by centrality"
                        darkMode={darkMode}
                        right={
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: 'rgba(14,165,164,0.12)', color: 'var(--accent-1)' }}>
                                Public Data
                            </span>
                        }
                    >
                        {nodeMetricsSummary.length === 0 ? (
                            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                No node metrics returned.
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={thStyle}>Node</th>
                                            <th style={thStyle}>Centrality</th>
                                            <th style={thStyle}>Normalized</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {nodeMetricsSummary.map((row, i) => {
                                            const alias = normalized.nodeByPub.get(row.pub)?.alias || shortHex(row.pub, 16);
                                            return (
                                                <tr key={`${row.pub}-${i}`} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}>
                                                    <td style={tdStyle}>
                                                        <div className="font-semibold" style={{ color: 'var(--accent-1)' }}>{alias || '—'}</div>
                                                        <div className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortHex(row.pub, 16)}</div>
                                                    </td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.value.toFixed(6)}</td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.normalized.toFixed(4)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </ChartCard>

                    {missionControl && (
                        <div
                            className="rounded-xl overflow-hidden transition-colors duration-300"
                            style={{
                                backgroundColor: 'var(--bg-card)',
                                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
                                boxShadow: 'var(--card-shadow)',
                            }}
                        >
                            <div className="flex items-center gap-3 px-4 pt-4 pb-0 border-b flex-wrap"
                                style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}>
                                <div className="pb-3 font-semibold text-sm">Pairs (top 200)</div>
                            </div>
                            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)' }}>
                                        <tr>
                                            <th style={thStyle}>From</th>
                                            <th style={thStyle}>To</th>
                                            <th style={thStyle}>Success amt</th>
                                            <th style={thStyle}>Fail amt</th>
                                            <th style={thStyle}>Last success</th>
                                            <th style={thStyle}>Last fail</th>
                                            <th style={thStyle}>Score</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {missionSummary.topPairsTable.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                                                    No mission control pairs available.
                                                </td>
                                            </tr>
                                        ) : missionSummary.topPairsTable.map((p, i) => {
                                            const fromAlias = normalized.nodeByPub.get(p.from)?.alias || shortHex(p.from, 16);
                                            const toAlias = normalized.nodeByPub.get(p.to)?.alias || shortHex(p.to, 16);
                                            return (
                                                <tr key={`${p.from}-${p.to}-${i}`} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}>
                                                    <td style={tdStyle}>
                                                        <div className="font-semibold" style={{ color: 'var(--accent-1)' }}>{fromAlias || '—'}</div>
                                                        <div className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortHex(p.from, 16)}</div>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <div className="font-semibold" style={{ color: 'var(--accent-2)' }}>{toAlias || '—'}</div>
                                                        <div className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortHex(p.to, 16)}</div>
                                                    </td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMsat(p.successAmtMsat)} msat</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent-3)' }}>{fmtMsat(p.failAmtMsat)} msat</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-secondary)' }}>{ageLabel(p.successAge)}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-secondary)' }}>{ageLabel(p.failAge)}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: p.score >= 0 ? 'var(--accent-1)' : 'var(--accent-4)' }}>{p.score.toFixed(2)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    

                    {/* Tables */}
                    <div className="rounded-xl overflow-hidden transition-colors duration-300"
                        style={{
                            backgroundColor: 'var(--bg-card)',
                            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
                            boxShadow: darkMode ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.05)',
                        }}>
                        {/* Tab row */}
                        <div className="flex items-center gap-4 px-4 pt-4 pb-0 border-b flex-wrap"
                            style={{ borderColor: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                            <button
                                onClick={() => setActiveTable('nodes')}
                                className="pb-3 font-semibold text-sm transition-colors border-b-2"
                                style={tabStyle(activeTable === 'nodes')}
                            >
                                Nodes ({normalized.nodes.length.toLocaleString()})
                            </button>
                            <button
                                onClick={() => setActiveTable('channels')}
                                className="pb-3 font-semibold text-sm transition-colors border-b-2"
                                style={tabStyle(activeTable === 'channels')}
                            >
                                Channels ({normalized.edges.length.toLocaleString()})
                            </button>
                            <div className="ml-auto pb-3">
                                <input
                                    value={activeTable === 'nodes' ? nodeQuery : edgeQuery}
                                    onChange={(e) => activeTable === 'nodes' ? setNodeQuery(e.target.value) : setEdgeQuery(e.target.value)}
                                    placeholder={activeTable === 'nodes' ? 'Search by alias or pubkey…' : 'Search by channel id, alias, or pubkey…'}
                                    className="px-3 py-1.5 rounded-lg text-sm outline-none"
                                    style={{
                                        minWidth: 260,
                                        backgroundColor: 'var(--input-bg)',
                                        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                                        color: 'var(--text-primary)',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Nodes table */}
                        {activeTable === 'nodes' && (
                            <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)' }}>
                                        <tr>
                                            <th style={thStyle}>#</th>
                                            <th style={thStyle}>Alias</th>
                                            <th style={thStyle}>Pubkey</th>
                                            <th style={thStyle}>Channels</th>
                                            <th style={thStyle}>Adjacent Capacity</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredNodes.length === 0 ? (
                                            <tr><td colSpan={5} className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>No matches.</td></tr>
                                        ) : filteredNodes.map((n, i) => (
                                            <tr key={n.pub_key} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 11 }}>{i + 1}</td>
                                                <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--accent-1)' }}>{n.alias || '—'}</td>
                                                <td style={{ ...tdStyle, fontFamily: 'monospace' }} title={n.pub_key}>{shortHex(n.pub_key, 18)}</td>
                                                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{n.channels.toLocaleString()}</td>
                                                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtSats(n.adjacentCapacity)} sats</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Channels table */}
                        {activeTable === 'channels' && (
                            <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)' }}>
                                        <tr>
                                            <th style={thStyle}>Channel ID</th>
                                            <th style={thStyle}>Node 1</th>
                                            <th style={thStyle}>Node 2</th>
                                            <th style={thStyle}>Capacity</th>
                                            <th style={thStyle}>Fee n1→n2</th>
                                            <th style={thStyle}>Fee n2→n1</th>
                                            <th style={thStyle}>Last Update</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredEdges.length === 0 ? (
                                            <tr><td colSpan={7} className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>No matches.</td></tr>
                                        ) : filteredEdges.map(({ e, n1, n2, a1, a2 }, i) => {
                                            const chanId = String(e.channel_id || e.channelId || '');
                                            const cap = toNum(e.capacity);
                                            const last = toNum(e.last_update ?? e.lastUpdate ?? 0);
                                            const date = last ? new Date(last * 1000).toLocaleString() : '—';
                                            const p1 = e.node1_policy || e.node1Policy;
                                            const p2 = e.node2_policy || e.node2Policy;
                                            const fmt1 = p1 ? `${toNum(getPolicyField(p1, 'feeRateMilliMsat', 'fee_rate_milli_msat'))?.toLocaleString()} ppm` : '—';
                                            const fmt2 = p2 ? `${toNum(getPolicyField(p2, 'feeRateMilliMsat', 'fee_rate_milli_msat'))?.toLocaleString()} ppm` : '—';
                                            return (
                                                <tr key={`${chanId}-${i}`} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }} title={chanId}>{shortHex(chanId, 18)}</td>
                                                    <td style={tdStyle} title={n1}>
                                                        <div className="font-semibold" style={{ color: 'var(--accent-1)' }}>{a1 || '—'}</div>
                                                        <div className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortHex(n1, 16)}</div>
                                                    </td>
                                                    <td style={tdStyle} title={n2}>
                                                        <div className="font-semibold" style={{ color: 'var(--accent-2)' }}>{a2 || '—'}</div>
                                                        <div className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortHex(n2, 16)}</div>
                                                    </td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 800, color: 'var(--accent-1)' }}>{fmtSats(cap)} sats</td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-3)' }}>{fmt1}</td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-3)' }}>{fmt2}</td>
                                                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{date}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default GraphAnalysisPage;

