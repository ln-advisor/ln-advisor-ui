import React, { useCallback, useMemo, useState } from 'react';
import {
    ResponsiveContainer,
    BarChart, Bar,
    XAxis, YAxis,
    Tooltip, CartesianGrid, Legend,
    ScatterChart, Scatter, ZAxis,
    ComposedChart, Line,
} from 'recharts';

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

// ── Custom scatter dot coloured by fee rate ───────────────────────────────
const FeeScatterDot = (props) => {
    const { cx, cy, payload } = props;
    const ppm = payload.ppm;
    let fill = 'var(--accent-1)'; // low fee
    if (ppm > 1000) fill = 'var(--accent-4)';
    else if (ppm > 300) fill = 'var(--accent-3)';
    return <circle cx={cx} cy={cy} r={4} fill={fill} fillOpacity={0.85} stroke="rgba(15,23,42,0.35)" strokeWidth={0.6} />;
};

const GraphAnalysisPage = ({ lnc, darkMode }) => {
    const [graph, setGraph] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [forwardingEvents, setForwardingEvents] = useState([]);
    const [forwardingError, setForwardingError] = useState(null);
    const [rangeDays, setRangeDays] = useState(7);
    const [includeUnannounced, setIncludeUnannounced] = useState(false);
    const [includeAuthProof, setIncludeAuthProof] = useState(false);
    const [nodeQuery, setNodeQuery] = useState('');
    const [edgeQuery, setEdgeQuery] = useState('');
    const [activeTable, setActiveTable] = useState('nodes');
    const [networkSize, setNetworkSize] = useState(36);
    const [showLabels, setShowLabels] = useState(true);
    const [focusNode, setFocusNode] = useState('');

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

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setForwardingError(null);
        try {
            const [graphResp, forwardingResp] = await Promise.all([
                fetchGraphData(),
                fetchForwardingData(),
            ]);
            if (graphResp) setGraph(graphResp);
            if (Array.isArray(forwardingResp)) setForwardingEvents(forwardingResp);
        } finally {
            setIsLoading(false);
        }
    }, [fetchGraphData, fetchForwardingData]);

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

        const capacities = [];
        const feeRatePpm = [];
        const feeBaseMsat = [];
        const tlDelta = [];
        let disabledPolicies = 0;
        let totalPolicies = 0;

        edges.forEach((e) => {
            const n1 = String(e.node1_pub || e.node1Pub || '').toLowerCase();
            const n2 = String(e.node2_pub || e.node2Pub || '').toLowerCase();
            const cap = toNum(e.capacity);

            if (cap > 0) capacities.push(cap);

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

            const policies = [e.node1_policy || e.node1Policy, e.node2_policy || e.node2Policy].filter(Boolean);
            policies.forEach((p) => {
                totalPolicies += 1;
                const disabled = Boolean(getPolicyField(p, 'disabled', 'disabled', false));
                if (disabled) disabledPolicies += 1;
                const ppm = toNum(getPolicyField(p, 'feeRateMilliMsat', 'fee_rate_milli_msat', 0));
                const base = toNum(getPolicyField(p, 'feeBaseMsat', 'fee_base_msat', 0));
                const tld = toNum(getPolicyField(p, 'timeLockDelta', 'time_lock_delta', 0));
                feeRatePpm.push(ppm);
                feeBaseMsat.push(base);
                tlDelta.push(tld);
            });
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
        const totalCapacity = capacities.reduce((s, v) => s + v, 0);

        return { nodes, edges, nodeByPub, nodeStats, totalCapacity, capacities, feeRatePpm, feeBaseMsat, tlDelta, disabledPolicies, totalPolicies, channelById };
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

    const kpis = useMemo(() => {
        const nodeCount = normalized.nodes.length;
        const edgeCount = normalized.edges.length;
        const cap = normalized.totalCapacity;
        const avgCap = edgeCount ? cap / edgeCount : 0;
        const disabledPct = normalized.totalPolicies ? (normalized.disabledPolicies / normalized.totalPolicies) * 100 : 0;
        const p95 = (arr) => {
            if (!arr?.length) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
            return sorted[idx];
        };
        return { nodeCount, edgeCount, cap, avgCap, feeP95: p95(normalized.feeRatePpm), feeBaseP95: p95(normalized.feeBaseMsat), disabledPct };
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

    const capacityBuckets = useMemo(() => {
        const buckets = [
            { label: '<1M', min: 0, max: 1_000_000 },
            { label: '1–5M', min: 1_000_000, max: 5_000_000 },
            { label: '5–10M', min: 5_000_000, max: 10_000_000 },
            { label: '10–50M', min: 10_000_000, max: 50_000_000 },
            { label: '50–100M', min: 50_000_000, max: 100_000_000 },
            { label: '≥100M', min: 100_000_000, max: Number.POSITIVE_INFINITY },
        ];
        return histogramFromBuckets(normalized.capacities, buckets);
    }, [normalized.capacities]);

    // Scatter: capacity vs fee rate (sample max 600 points)
    const scatterData = useMemo(() => {
        const edges = normalized.edges;
        const result = [];
        const step = Math.max(1, Math.floor(edges.length / 600));
        for (let i = 0; i < edges.length; i += step) {
            const e = edges[i];
            const cap = toNum(e.capacity);
            if (!cap) continue;
            const policies = [e.node1_policy || e.node1Policy, e.node2_policy || e.node2Policy].filter(Boolean);
            for (const p of policies) {
                const ppm = toNum(getPolicyField(p, 'feeRateMilliMsat', 'fee_rate_milli_msat', 0));
                if (ppm > 100_000) continue; // outlier filter
                result.push({ cap: Math.round(cap / 1000), ppm });
            }
        }
        return result;
    }, [normalized.edges]);

    // ComposedChart: fee base msat vs fee rate histogram overlaid
    const feeComboData = useMemo(() => {
        const buckets = [
            { label: '0–100', min: 0, max: 100 },
            { label: '100–500', min: 100, max: 500 },
            { label: '500–1k', min: 500, max: 1_000 },
            { label: '1k–5k', min: 1_000, max: 5_000 },
            { label: '5k–10k', min: 5_000, max: 10_000 },
            { label: '≥10k', min: 10_000, max: Number.POSITIVE_INFINITY },
        ];
        const hist = histogramFromBuckets(normalized.feeRatePpm, buckets);
        // compute median fee base per bucket
        const baseBuckets = buckets.map(b => {
            const vals = normalized.feeRatePpm.flatMap((ppm, idx) => {
                const n = toNum(ppm);
                if (n >= b.min && n < b.max) return [normalized.feeBaseMsat[idx]];
                return [];
            }).filter(Boolean).sort((a, b) => a - b);
            const mid = Math.floor(vals.length / 2);
            const median = vals.length > 0 ? (vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2) : 0;
            return Math.round(median);
        });
        return hist.map((h, i) => ({ label: h.label, channels: h.count, medianBase: baseBuckets[i] }));
    }, [normalized.feeRatePpm, normalized.feeBaseMsat]);

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

    return (
        <div className="px-6 pb-10 pt-8 space-y-8" style={{ maxWidth: 1280, margin: '0 auto' }}>
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-2xl md:text-3xl font-semibold font-display" style={{ color: 'var(--text-primary)' }}>
                            Graph Analysis
                        </h2>
                        <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: 'var(--badge-bg)', color: 'var(--text-secondary)' }}>
                            describeGraph
                        </span>
                    </div>
                    <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                        Snapshot and explore network structure, fee strategies, and channel distribution in one view.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                        style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: 'var(--text-secondary)' }}>
                        <span className="uppercase tracking-widest font-semibold">Range</span>
                        <select
                            value={rangeDays}
                            onChange={(e) => setRangeDays(Number(e.target.value))}
                            className="bg-transparent outline-none text-xs"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <option value={7}>7d</option>
                            <option value={14}>14d</option>
                            <option value={30}>30d</option>
                            <option value={90}>90d</option>
                        </select>
                    </div>
                    <label className="text-xs flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
                        style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={includeUnannounced} onChange={(e) => setIncludeUnannounced(e.target.checked)} />
                        include_unannounced
                    </label>
                    <label className="text-xs flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
                        style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={includeAuthProof} onChange={(e) => setIncludeAuthProof(e.target.checked)} />
                        include_auth_proof
                    </label>
                    <button
                        onClick={fetchData}
                        disabled={isLoading}
                        style={{
                            padding: '10px 18px',
                            borderRadius: 12,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            border: 'none',
                            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
                            color: '#fff',
                            boxShadow: darkMode ? '0 8px 18px rgba(34,211,238,0.25)' : '0 8px 18px rgba(37,99,235,0.2)',
                            opacity: isLoading ? 0.7 : 1,
                            transition: 'opacity 0.2s',
                        }}
                    >
                        {isLoading ? 'Loading…' : 'Fetch Data'}
                    </button>
                    <button
                        onClick={() => graph && makeDownload(`describeGraph-${new Date().toISOString()}.json`, graph)}
                        disabled={!graph}
                        style={{
                            padding: '10px 14px',
                            borderRadius: 12,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: graph ? 'pointer' : 'not-allowed',
                            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.16)'}`,
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            opacity: graph ? 1 : 0.5,
                        }}
                    >
                        Export JSON
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-text)' }}>
                    {error}
                </div>
            )}
            {forwardingError && (
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-text)' }}>
                    {forwardingError}
                </div>
            )}

            {!graph && !isLoading && !error && (
                <div className="rounded-xl p-8 text-sm text-center" style={{ backgroundColor: 'var(--form-bg)', color: 'var(--text-secondary)' }}>
                    <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                        Ready When You Are
                    </div>
                    <p>Click <span className="font-semibold" style={{ color: 'var(--accent-2)' }}>Fetch Data</span> to load the Lightning network snapshot and forwarding history.</p>
                </div>
            )}

            {graph && (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Nodes" value={kpis.nodeCount.toLocaleString()} darkMode={darkMode} color="var(--accent-2)" />
                        <StatCard title="Channels" value={kpis.edgeCount.toLocaleString()} darkMode={darkMode} color="var(--accent-1)" />
                        <StatCard title="Total Capacity" value={`${fmtSats(kpis.cap)} sats`} darkMode={darkMode} color="var(--accent-3)"
                            sub={`Avg ${fmtSats(kpis.avgCap)} sats / channel`} />
                        <StatCard
                            title="Disabled Policies"
                            value={`${kpis.disabledPct.toFixed(1)}%`}
                            darkMode={darkMode}
                            color={kpis.disabledPct >= 25 ? 'var(--accent-4)' : 'var(--accent-3)'}
                            sub={`P95 fee: ${Math.round(kpis.feeP95).toLocaleString()} ppm · P95 base: ${Math.round(kpis.feeBaseP95).toLocaleString()} msat`}
                        />
                    </div>

                    {/* Forwarding intelligence */}
                    <ChartCard
                        title="Forwarding Intelligence"
                        subtitle={`Private forwarding history · last ${rangeDays} days`}
                        darkMode={darkMode}
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

                    {/* Row 1: Top nodes + Fee ComposedChart */}
                    <div className="grid lg:grid-cols-2 gap-4">
                        <ChartCard
                            title="Top nodes by channel count"
                            subtitle="Connectivity (degree) + adjacent capacity in M sats"
                            darkMode={darkMode}
                        >
                            {topNodesByDegree.length === 0 ? (
                                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No data.</div>
                            ) : (
                                <div style={{ width: '100%', height: 320 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={topNodesByDegree} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
                                            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                            <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={70} />
                                            <YAxis yAxisId="left" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                labelStyle={{ color: 'var(--text-secondary)' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)', paddingTop: 8 }} />
                                            <Bar yAxisId="left" dataKey="channels" fill="var(--accent-2)" radius={[6, 6, 0, 0]} name="Channels" />
                                            <Line yAxisId="right" type="monotone" dataKey="capacity" stroke="var(--accent-3)" dot={false} strokeWidth={2} name="Capacity (M sats)" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </ChartCard>

                        <ChartCard
                            title="Fee rate vs. Fee base (policy overview)"
                            subtitle="Bars = channel count per fee-rate bucket · Line = median fee base (msat)"
                            darkMode={darkMode}
                        >
                            <div style={{ width: '100%', height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={feeComboData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                        <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                        <YAxis yAxisId="left" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                        <Tooltip
                                            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                            labelStyle={{ color: 'var(--text-secondary)' }}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)', paddingTop: 8 }} />
                                        <Bar yAxisId="left" dataKey="channels" fill="var(--accent-3)" radius={[4, 4, 0, 0]} name="# Channels" />
                                        <Line yAxisId="right" type="monotone" dataKey="medianBase" stroke="var(--accent-1)" strokeWidth={2} dot={{ r: 3 }} name="Median base (msat)" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </ChartCard>
                    </div>

                    {/* Row 2: Capacity histogram + Scatter */}
                    <div className="grid lg:grid-cols-2 gap-4">
                        <ChartCard
                            title="Channel capacity distribution"
                            subtitle="Number of channels per capacity bucket (sats)"
                            darkMode={darkMode}
                        >
                            <div style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={capacityBuckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                        <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                        <YAxis tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                                        <Tooltip
                                            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                            labelStyle={{ color: 'var(--text-secondary)' }}
                                        />
                                        <Bar dataKey="count" fill="var(--accent-1)" radius={[6, 6, 0, 0]} name="Channels" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </ChartCard>

                        <ChartCard
                            title="Capacity vs. Fee rate (scatter)"
                            subtitle="Each dot = one channel direction · hover to see exact values"
                            darkMode={darkMode}
                            right={
                                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest"
                                    style={{ color: 'var(--text-secondary)' }}>
                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: 'var(--badge-bg)' }}>
                                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--accent-1)' }} />
                                        ≤300 ppm
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: 'var(--badge-bg)' }}>
                                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--accent-3)' }} />
                                        ≤1k ppm
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: 'var(--badge-bg)' }}>
                                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--accent-4)' }} />
                                        &gt;1k ppm
                                    </span>
                                </div>
                            }
                        >
                            {scatterData.length === 0 ? (
                                <div className="text-sm h-64 flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>No policy data available.</div>
                            ) : (
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                                            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                            <XAxis dataKey="cap" name="Capacity (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }}
                                                label={{ value: 'Cap (k sats)', position: 'insideBottomRight', offset: -10, fill: chartTheme.axis, fontSize: 10 }} />
                                            <YAxis dataKey="ppm" name="Fee rate (ppm)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }}
                                                label={{ value: 'ppm', angle: -90, position: 'insideLeft', fill: chartTheme.axis, fontSize: 10 }} />
                                            <ZAxis range={[12, 12]} />
                                            <Tooltip
                                                cursor={{ strokeDasharray: '3 3' }}
                                                wrapperStyle={{ zIndex: 30 }}
                                                contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                labelStyle={{ color: 'var(--text-secondary)' }}
                                                itemStyle={{ color: 'var(--text-primary)' }}
                                                formatter={(v, name) => {
                                                    if (name === 'cap') return [`${Number(v).toLocaleString()} k sats`, 'Capacity'];
                                                    if (name === 'ppm') return [`${Number(v).toLocaleString()} ppm`, 'Fee rate'];
                                                    return [v, name];
                                                }}
                                                labelFormatter={() => 'Channel direction'}
                                            />
                                            <Scatter data={scatterData} shape={<FeeScatterDot />} />
                                        </ScatterChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </ChartCard>
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
