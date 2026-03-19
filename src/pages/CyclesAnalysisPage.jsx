import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
    ResponsiveContainer,
    BarChart, Bar,
    XAxis, YAxis,
    Tooltip, CartesianGrid, Cell,
    Sankey
} from 'recharts';
import SectionBadge from '../components/analysis/SectionBadge';
import ErrorBanner from '../components/analysis/ErrorBanner';
import InlineSpinner from '../components/analysis/InlineSpinner';
import DataSourceLegend from '../components/analysis/DataSourceLegend';

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


const FlowTopologyGraph = ({ circuits, nodesMetadata, darkMode }) => {
    const [hoveredPeer, setHoveredPeer] = useState(null);

    if (!circuits || circuits.length === 0) {
        return <div className="h-full flex items-center justify-center text-slate-500 italic">No forwarding circuits to visualize</div>;
    }

    const width = 800; // Wider for full-width layout
    const height = 450;
    const center = { x: width / 2, y: height / 2 };
    const radius = 160;

    // Unique peers involved in circuits
    const peerNames = [...new Set([
        ...circuits.map(c => c.src),
        ...circuits.map(c => c.dst)
    ])];
    
    const peerPositions = new Map();
    peerNames.forEach((name, i) => {
        const angle = (i / peerNames.length) * 2 * Math.PI - Math.PI / 2;
        peerPositions.set(name, {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
            name
        });
    });

    const getArcPath = (start, end, bend = 25) => {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
        const nx = -dy / len;
        const ny = dx / len;
        const cpX = midX + nx * bend;
        const cpY = midY + ny * bend;
        return `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;
    };

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            <defs>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>

            {/* Circuits (Paths) */}
            {circuits.map((circ, i) => {
                const srcPos = peerPositions.get(circ.src);
                const dstPos = peerPositions.get(circ.dst);
                if (!srcPos || !dstPos) return null;

                const isHighlighted = hoveredPeer === circ.src || hoveredPeer === circ.dst;
                const strokeWidth = Math.max(1.5, Math.min(8, Math.log10(circ.val + 1) * 2.5));
                const opacity = hoveredPeer ? (isHighlighted ? 0.95 : 0.05) : 0.3;
                
                // Color coding: Blue for Inbound, Red for Outbound
                const colorIn = "var(--accent-2)";
                const colorOut = "var(--accent-3)";
                const activeColor = isHighlighted ? (hoveredPeer === circ.src ? colorIn : colorOut) : (darkMode ? "#818cf8" : "#6366f1");

                const pathIn = getArcPath(srcPos, center, 30);
                const pathOut = getArcPath(center, dstPos, -30);

                return (
                    <g key={`circ-${i}`} style={{ transition: 'opacity 0.3s' }} opacity={opacity}>
                        {/* Inlet: Peer -> Me */}
                        <path d={pathIn} stroke={colorIn} strokeWidth={strokeWidth} fill="none" strokeOpacity={0.5} />
                        {/* Outlet: Me -> Peer */}
                        <path d={pathOut} stroke={colorOut} strokeWidth={strokeWidth} fill="none" strokeOpacity={0.5} />
                        
                        {/* Flow Particles */}
                        <circle r={strokeWidth/2 + 1} fill={colorIn} filter="url(#glow)">
                            <animateMotion
                                dur={`${Math.max(0.6, 4 - Math.log10(circ.val + 1))}s`}
                                repeatCount="indefinite"
                                path={pathIn}
                            />
                        </circle>
                        <circle r={strokeWidth/2 + 1} fill={colorOut} filter="url(#glow)">
                            <animateMotion
                                dur={`${Math.max(0.6, 4 - Math.log10(circ.val + 1))}s`}
                                repeatCount="indefinite"
                                path={pathOut}
                                begin="0.2s"
                            />
                        </circle>
                    </g>
                );
            })}

            {/* Peer Nodes */}
            {[...peerPositions.values()].map((peer, i) => {
                const isHovered = hoveredPeer === peer.name;
                const metadata = nodesMetadata.get(peer.name);
                
                // Role-based coloring: Balanced = Green, Source = Blue, Drain = Red
                let nodeColor = "#94a3b8"; // Default
                if (metadata) {
                    if (metadata.flowType === 'Balanced') nodeColor = "var(--accent-1)";
                    else if (metadata.flowType === 'Source') nodeColor = "var(--accent-2)";
                    else if (metadata.flowType === 'Drain') nodeColor = "var(--accent-3)";
                }

                return (
                    <g 
                        key={`peer-${i}`} 
                        onMouseEnter={() => setHoveredPeer(peer.name)} 
                        onMouseLeave={() => setHoveredPeer(null)}
                        className="cursor-pointer"
                    >
                        <circle 
                            cx={peer.x} cy={peer.y} r={isHovered ? 14 : 10} 
                            fill={nodeColor} 
                            stroke={darkMode ? "#1e293b" : "#fff"} 
                            strokeWidth="2" 
                            style={{ transition: 'all 0.2s' }}
                            filter={isHovered ? "url(#glow)" : ""}
                        />
                        <text 
                            x={peer.x} y={peer.y + (peer.y > center.y ? 28 : -22)} 
                            textAnchor="middle" 
                            fontSize={isHovered ? "11" : "9"} 
                            fontWeight={isHovered ? "700" : "600"}
                            fill={darkMode ? "rgba(255,255,255,0.95)" : "rgba(15,23,42,0.9)"}
                            style={{ transition: 'all 0.2s', textShadow: darkMode ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}
                        >
                            {peer.name}
                        </text>
                        {isHovered && metadata && (
                            <text 
                                x={peer.x} y={peer.y + (peer.y > center.y ? 42 : 38)} 
                                textAnchor="middle" fontSize="9" fill="var(--text-secondary)" fontWeight="bold"
                            >
                                {metadata.flowType}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Your Node (Center) */}
            <circle cx={center.x} cy={center.y} r="18" fill="var(--bg-app)" stroke="var(--accent-1)" strokeWidth="3" filter="url(#glow)" />
            <text x={center.x} y={center.y + 6} textAnchor="middle" fontSize="10" fontWeight="900" fill="var(--accent-1)" pointerEvents="none">YOU</text>
        </svg>
    );
};

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

const FLOW_COLORS = {
    Balanced: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
    Source:   { bg: 'rgba(37,99,235,0.15)',  text: 'var(--accent-2)' },
    Drain:    { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444' },
    Idle:     { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' },
};

const CyclesAnalysisPage = ({ lnc, darkMode }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [forwardingEvents, setForwardingEvents] = useState([]);
    const [channels, setChannels] = useState([]);
    const [aliasMap, setAliasMap] = useState({});
    const [rangeDays, setRangeDays] = useState(7);
    const [hasStarted, setHasStarted] = useState(false);

    const fetchForwardingData = useCallback(async () => {
        if (!lnc?.lnd?.lightning?.forwardingHistory) {
            console.warn('forwardingHistory not available on this node');
            return [];
        }
        try {
            const end = Math.floor(Date.now() / 1000);
            const start = end - (rangeDays * 24 * 3600);
            console.log(`Fetching events from ${start} to ${end}`);
            const response = await lnc.lnd.lightning.forwardingHistory({
                start_time: String(start),
                end_time: String(end),
                index_offset: 0,
                num_max_events: 5000,
            });
            const events = response?.forwardingEvents || response?.forwarding_events || [];
            console.log('forwardingHistory response size:', events.length);
            return Array.isArray(events) ? events : [];
        } catch (e) {
            console.error('forwardingHistory failed:', e);
            throw e;
        }
    }, [lnc, rangeDays]);

    const fetchChannelsData = useCallback(async () => {
        if (!lnc?.lnd?.lightning?.listChannels) return [];
        try {
            const response = await lnc.lnd.lightning.listChannels({});
            const chans = Array.isArray(response?.channels) ? response.channels : [];
            
            // Kick off alias fetching in the background
            if (chans.length > 0) {
                const uniquePubkeys = [...new Set(chans.map(ch => ch.remote_pubkey || ch.remotePubkey).filter(Boolean))];
                Promise.allSettled(
                    uniquePubkeys.map(pk => 
                        lnc.lnd.lightning.getNodeInfo({ pub_key: pk, include_channels: false })
                            .then(info => ({ pk, alias: info?.node?.alias || '' }))
                            .catch(() => ({ pk, alias: '' }))
                    )
                ).then(results => {
                    const newAliases = {};
                    results.forEach(r => {
                        if (r.status === 'fulfilled') newAliases[r.value.pk] = r.value.alias;
                    });
                    setAliasMap(prev => ({ ...prev, ...newAliases }));
                });
            }

            return chans;
        } catch (e) {
            console.error('listChannels failed:', e);
            throw e;
        }
    }, [lnc]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setHasStarted(true);
        
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Connection timeout: Node is taking too long to respond.')), 15000);
        });

        try {
            console.log('Starting data fetch for cycles analysis...');
            const fetchPromise = Promise.all([
                fetchForwardingData(),
                fetchChannelsData(),
            ]);

            const [forwardingResp, channelsResp] = await Promise.race([fetchPromise, timeoutPromise]);
            
            console.log('Fetch complete:', { 
                events: forwardingResp?.length, 
                channels: channelsResp?.length 
            });
            setForwardingEvents(forwardingResp || []);
            setChannels(channelsResp || []);
        } catch (err) {
            console.error('fetchData error:', err);
            setError(err.message || 'Failed to fetch node data. Check node connection.');
        } finally {
            setIsLoading(false);
        }
    }, [fetchForwardingData, fetchChannelsData]);

    const cyclesSummary = useMemo(() => {
        if (!channels || channels.length === 0) return null;

        const volIn = new Map();
        const volOut = new Map();
        for (const ev of forwardingEvents) {
            const cIn  = String(ev.chanIdIn  || ev.chan_id_in  || '').trim();
            const cOut = String(ev.chanIdOut || ev.chan_id_out || '').trim();
            const amtIn  = toNum(ev.amtIn  ?? ev.amt_in  ?? 0);
            const amtOut = toNum(ev.amtOut ?? ev.amt_out ?? 0);
            if (cIn)  volIn.set(cIn,  (volIn.get(cIn)  || 0) + amtIn);
            if (cOut) volOut.set(cOut, (volOut.get(cOut) || 0) + amtOut);
        }

        const rows = channels.map((ch) => {
            const id  = String(ch.chanId || ch.chan_id || '').trim();
            const cap = toNum(ch.capacity);
            const local = toNum(ch.localBalance || ch.local_balance);
            const in_  = volIn.get(id)  || 0;
            const out_ = volOut.get(id) || 0;
            const hasFlow = in_ > 0 || out_ > 0;
            const netFlow = in_ - out_;
            const circularity = hasFlow
                ? Math.min(in_, out_) / Math.max(in_, out_)
                : null;
            const netOutflow = -netFlow;
            const runwayMultiplier = netOutflow > 0 && local > 0
                ? local / netOutflow
                : null;
            const circ = circularity ?? 0;
            const flowType = !hasFlow ? 'Idle'
                : circ >= 0.75 ? 'Balanced'
                : netFlow > 0  ? 'Source'
                : 'Drain';
            
            const peerPubkey = String(ch.remote_pubkey || ch.remotePubkey || '').toLowerCase();
            const alias = aliasMap[peerPubkey] || '';
            
            return { id, cap, local, in_, out_, netFlow, circularity, runwayMultiplier, flowType, peerPubkey, alias };
        });

        const drains   = rows.filter(r => r.flowType === 'Drain').sort((a, b) => (a.runwayMultiplier ?? Infinity) - (b.runwayMultiplier ?? Infinity));
        const sources  = rows.filter(r => r.flowType === 'Source');
        const balanced = rows.filter(r => r.flowType === 'Balanced');
        const idle     = rows.filter(r => r.flowType === 'Idle');

        const activeRows = rows.filter(r => r.flowType !== 'Idle');
        const avgCircularity = activeRows.length > 0
            ? activeRows.reduce((s, r) => s + (r.circularity ?? 0), 0) / activeRows.length
            : null;

        const criticalDrains = drains.filter(r => r.runwayMultiplier !== null && r.runwayMultiplier < 5);

        // Map chanId to Peer Label
        const chanToPeer = new Map();
        rows.forEach(r => {
            chanToPeer.set(r.id, r.alias || shortHex(r.peerPubkey, 10));
        });

        // 1. Granular P2P Flow Mapping (Circuits)
        const p2pCount = new Map(); // "LabelA:::LabelB" => volume
        const p2pCircuits = []; // [{ src, dst, val }]
        
        for (const ev of forwardingEvents) {
            const cidIn  = String(ev.chanIdIn  || ev.chan_id_in  || '').trim();
            const cidOut = String(ev.chanIdOut || ev.chan_id_out || '').trim();
            if (!cidIn || !cidOut) continue;

            const pIn  = chanToPeer.get(cidIn);
            const pOut = chanToPeer.get(cidOut);
            if (!pIn || !pOut) continue;

            const key = `${pIn}:::${pOut}`;
            const amt = toNum(ev.amtOut ?? ev.amt_out ?? 0);
            p2pCount.set(key, (p2pCount.get(key) || 0) + amt);
        }

        // 2. Prepare Top Circuits
        [...p2pCount.entries()]
            .sort((a,b) => b[1] - a[1])
            .slice(0, 15)
            .forEach(([key, val]) => {
                const [src, dst] = key.split(':::');
                p2pCircuits.push({ src, dst, val });
            });

        // 3. Sankey Data (Aggregation for visualization)
        const sankeyNodes = [{ name: 'Your Node' }];
        const sankeyLinks = [];
        const nodeIdxMap = new Map();
        nodeIdxMap.set('Your Node', 0);

        const getIdx = (name) => {
            if (nodeIdxMap.has(name)) return nodeIdxMap.get(name);
            sankeyNodes.push({ name });
            const idx = sankeyNodes.length - 1;
            nodeIdxMap.set(name, idx);
            return idx;
        };

        p2pCircuits.forEach(({ src, dst, val }) => {
            const srcIdx = getIdx(`${src} (In)`);
            sankeyLinks.push({ source: srcIdx, target: 0, value: val });
            const dstIdx = getIdx(`${dst} (Out)`);
            sankeyLinks.push({ source: 0, target: dstIdx, value: val });
        });

        const sankeyData = { nodes: sankeyNodes, links: sankeyLinks };

        const chartData = [
            { label: 'Balanced', count: balanced.length, fill: 'var(--accent-1)' },
            { label: 'Source',   count: sources.length,  fill: 'var(--accent-2)' },
            { label: 'Drain',    count: drains.length,   fill: 'var(--accent-3)' },
            { label: 'Idle',     count: idle.length,     fill: '#94a3b8' },
        ];

        // Metadata for Graph Component
        const nodesMetadata = new Map();
        rows.forEach(r => {
            const label = r.alias || shortHex(r.peerPubkey, 10);
            nodesMetadata.set(label, { flowType: r.flowType, netFlow: r.netFlow });
        });

        return { rows, drains, sources, balanced, idle, avgCircularity, criticalDrains, chartData, sankeyData, p2pCircuits, nodesMetadata };
    }, [channels, forwardingEvents, aliasMap]);

    const chartTheme = useMemo(() => {
        const axis = darkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
        const grid = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const tooltipBg = darkMode ? '#0b1220' : '#ffffff';
        const tooltipBorder = darkMode ? '#334155' : '#e5e7eb';
        return { axis, grid, tooltipBg, tooltipBorder };
    }, [darkMode]);

    const thStyle = {
        padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
        whiteSpace: 'nowrap',
    };

    const tdStyle = {
        padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
        whiteSpace: 'nowrap',
    };

    return (
        <div className="p-6 space-y-8 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <SectionBadge label="Economic Intelligence" />
                    <h1 className="text-3xl font-bold mt-2" style={{ color: 'var(--accent-2)' }}>
                        Liquidity Cycles & Return Flow
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Cycles Protocol analysis — does liquidity return after it leaves?
                    </p>
                </div>
                {hasStarted && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchData}
                            disabled={isLoading}
                            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                        >
                            {isLoading ? <InlineSpinner /> : 'Refresh Data'}
                        </button>
                        <select
                            value={rangeDays}
                            onChange={(e) => setRangeDays(Number(e.target.value))}
                            className="px-3 py-2 rounded-xl text-sm bg-transparent border transition-all"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-card)' }}
                        >
                            <option value={1}>Last 24h</option>
                            <option value={7}>Last 7 days</option>
                            <option value={30}>Last 30 days</option>
                        </select>
                    </div>
                )}
            </header>

            {!hasStarted ? (
                <div className="max-w-2xl mx-auto py-12 space-y-8">
                    <div className="text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" 
                             style={{ background: 'rgba(96,165,250,0.1)', color: 'var(--accent-2)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold">Ready to analyze your Liquidity Cycles?</h2>
                        <p style={{ color: 'var(--text-secondary)' }}>
                            This analysis uses the Cycles Protocol principles to determine if sats leaving your channels eventually return, 
                            identifying drains, sources, and balanced loops.
                        </p>
                    </div>

                    <div className="rounded-2xl p-6 space-y-4" 
                         style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                        <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                            Data Sources & Transparency
                        </h3>
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="text-xl">⚡</div>
                                <div>
                                    <p className="font-semibold text-sm">ListChannels</p>
                                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        Used to read current local/remote balances and channel capacities to calculate "Runway" – how long your channel can sustain current net outflows.
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="text-xl">⇄</div>
                                <div>
                                    <p className="font-semibold text-sm">forwardingHistory</p>
                                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        Analyzes successfull forwards over the last {rangeDays} days to track circularity. Circularity measures if outgoing sats eventually return through other channels.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                            <p className="text-[10px] uppercase font-bold tracking-tighter" style={{ color: 'var(--accent-4)' }}>
                                🔒 All analysis is performed locally. Raw data never leaves your machine.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        <select
                            value={rangeDays}
                            onChange={(e) => setRangeDays(Number(e.target.value))}
                            className="px-4 py-2 rounded-xl text-sm bg-transparent border transition-all w-full max-w-xs text-center font-semibold"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-card)' }}
                        >
                            <option value={1}>Lookback window: 24 Hours</option>
                            <option value={7}>Lookback window: 7 Days</option>
                            <option value={30}>Lookback window: 30 Days</option>
                        </select>
                        <button
                            onClick={fetchData}
                            disabled={isLoading}
                            className="w-full max-w-xs py-4 rounded-2xl font-bold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
                            style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))' }}
                        >
                            {isLoading ? <InlineSpinner /> : 'Start Liquidity Analysis'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-8">
                    <DataSourceLegend 
                        sources={[
                            { label: 'listChannels', icon: '⚡' },
                            { label: 'forwardingHistory', icon: '⇄' }
                        ]} 
                    />

                    {error && <ErrorBanner message={error} />}

                    {isLoading && !cyclesSummary && (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <InlineSpinner />
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Analyzing liquidity cycles...</p>
                        </div>
                    )}

                    {!isLoading && cyclesSummary && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatCard
                                    title="Avg Circularity"
                                    value={cyclesSummary.avgCircularity !== null
                                        ? `${(cyclesSummary.avgCircularity * 100).toFixed(0)}%`
                                        : '—'}
                                    sub="1.0 = perfect return flow"
                                    color={cyclesSummary.avgCircularity !== null && cyclesSummary.avgCircularity >= 0.65
                                        ? 'var(--accent-1)'
                                        : cyclesSummary.avgCircularity !== null && cyclesSummary.avgCircularity >= 0.3
                                        ? 'var(--accent-2)'
                                        : 'var(--accent-3)'}
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    title="Drain Channels"
                                    value={cyclesSummary.drains.length}
                                    sub={`${cyclesSummary.criticalDrains.length} critical (< 5x runway)`}
                                    color={cyclesSummary.drains.length > 0 ? 'var(--accent-3)' : 'var(--accent-1)'}
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    title="Source Channels"
                                    value={cyclesSummary.sources.length}
                                    sub="Liquidity surplus inbound"
                                    color="var(--accent-2)"
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    title="Balanced Channels"
                                    value={cyclesSummary.balanced.length}
                                    sub="≥ 75% circular return"
                                    color="var(--accent-1)"
                                    darkMode={darkMode}
                                />
                            </div>

                            <div className="rounded-xl p-4 text-xs leading-relaxed"
                                style={{
                                    background: darkMode ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)',
                                    border: `1px solid ${darkMode ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)'}`,
                                    color: 'var(--text-secondary)',
                                }}>
                                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>How to read this: </span>
                                A <span style={{ color: FLOW_COLORS.Drain.text, fontWeight: 700 }}>Drain</span> channel routes more sats out than in — left unchecked, its local balance empties and forwarding fails.
                                A <span style={{ color: FLOW_COLORS.Source.text, fontWeight: 700 }}>Source</span> accumulates inbound liquidity.
                                A <span style={{ color: FLOW_COLORS.Balanced.text, fontWeight: 700 }}>Balanced</span> channel forms a complete Cycle: sats leave and return naturally.
                                The <em>Runway</em> shows how many times the current local balance can cover the observed net outflow.
                            </div>

                            {cyclesSummary.criticalDrains.length > 0 && (
                                <div className="rounded-xl p-4 text-sm"
                                    style={{
                                        background: darkMode ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.08)',
                                        border: `1px solid ${darkMode ? 'rgba(239,68,68,0.30)' : 'rgba(239,68,68,0.20)'}`,
                                    }}>
                                    <p className="font-semibold text-xs uppercase tracking-widest mb-2" style={{ color: '#ef4444' }}>
                                        ⚠ Critical Drains — rebalance soon
                                    </p>
                                    <div className="space-y-1">
                                        {cyclesSummary.criticalDrains.slice(0, 5).map(r => (
                                            <div key={r.id} className="flex items-center justify-between text-xs">
                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                    {r.alias || shortHex(r.peerPubkey, 12)}
                                                </span>
                                                <span style={{ color: '#ef4444', fontWeight: 700 }}>
                                                    Runway ×{r.runwayMultiplier?.toFixed(1) ?? '—'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-1">
                                    <ChartCard title="Flow classification" darkMode={darkMode}>
                                        <div style={{ width: '100%', height: 260 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={cyclesSummary.chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                                    <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                                                    <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 12 }} />
                                                    <YAxis tick={{ fill: chartTheme.axis, fontSize: 12 }} allowDecimals={false} />
                                                    <Tooltip
                                                        contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                                                    />
                                                    <Bar dataKey="count" radius={[8, 8, 0, 0]} name="Channels">
                                                        {cyclesSummary.chartData.map((entry) => (
                                                            <Cell key={entry.label} fill={entry.fill} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </ChartCard>
                                </div>

                                {/* Flow Graph - Expands to fill remaining grid space or full width */}
                                <div className="lg:col-span-2">
                                    <ChartCard title="Satoshi Forwarding Circuits" subtitle="Top Peer-to-Peer flow paths through your node. Blue = Inbound, Red = Outbound." darkMode={darkMode}>
                                        <div style={{ width: '100%', height: 450 }}>
                                            <FlowTopologyGraph 
                                                circuits={cyclesSummary.p2pCircuits} 
                                                nodesMetadata={cyclesSummary.nodesMetadata}
                                                darkMode={darkMode} 
                                            />
                                        </div>
                                    </ChartCard>
                                </div>

                                <div className="lg:col-span-3">
                                     <ChartCard title="Per-channel cycles detail" darkMode={darkMode}>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={thStyle}>Channel</th>
                                                        <th style={thStyle}>Peer / Alias</th>
                                                        <th style={thStyle}>Type</th>
                                                        <th style={thStyle}>Vol In</th>
                                                        <th style={thStyle}>Vol Out</th>
                                                        <th style={thStyle}>Net Flow</th>
                                                        <th style={thStyle}>Circularity</th>
                                                        <th style={thStyle}>Runway ×</th>
                                                        <th style={thStyle}>Local Balance</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[...cyclesSummary.rows]
                                                        .sort((a, b) => {
                                                            const order = { Drain: 0, Source: 1, Balanced: 2, Idle: 3 };
                                                            return (order[a.flowType] ?? 9) - (order[b.flowType] ?? 9);
                                                        })
                                                        .map(r => {
                                                            const fc = FLOW_COLORS[r.flowType] || FLOW_COLORS.Idle;
                                                            const circPct = r.circularity !== null
                                                                ? `${(r.circularity * 100).toFixed(0)}%`
                                                                : '—';
                                                            const runway = r.runwayMultiplier !== null
                                                                ? `×${r.runwayMultiplier.toFixed(1)}`
                                                                : r.flowType === 'Drain' ? '∞' : '—';
                                                            return (
                                                                <tr key={r.id}>
                                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                                                                        {shortHex(r.id, 16)}
                                                                    </td>
                                                                    <td style={{ ...tdStyle, fontSize: 12 }}>
                                                                        {r.alias ? (
                                                                            <span style={{ fontWeight: 600 }}>{r.alias}</span>
                                                                        ) : (
                                                                            <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>{shortHex(r.peerPubkey, 12)}</span>
                                                                        )}
                                                                    </td>
                                                                    <td style={tdStyle}>
                                                                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                                                            style={{ background: fc.bg, color: fc.text }}>
                                                                            {r.flowType}
                                                                        </span>
                                                                    </td>
                                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtSats(r.in_)}</td>
                                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtSats(r.out_)}</td>
                                                                    <td style={{
                                                                        ...tdStyle,
                                                                        fontFamily: 'monospace',
                                                                        color: r.netFlow < 0 ? '#ef4444' : r.netFlow > 0 ? 'var(--accent-1)' : 'var(--text-secondary)',
                                                                        fontWeight: 600,
                                                                    }}>
                                                                        {r.netFlow >= 0 ? '+' : ''}{fmtSats(r.netFlow)}
                                                                    </td>
                                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                                                                        {r.circularity !== null ? (
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                                <div style={{
                                                                                    width: 48, height: 6, borderRadius: 3,
                                                                                    background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                                                                    overflow: 'hidden',
                                                                                }}>
                                                                                    <div style={{
                                                                                        height: '100%',
                                                                                        width: `${(r.circularity * 100).toFixed(0)}%`,
                                                                                        background: fc.text,
                                                                                        borderRadius: 3,
                                                                                    }} />
                                                                                </div>
                                                                                {circPct}
                                                                            </div>
                                                                        ) : '—'}
                                                                    </td>
                                                                    <td style={{
                                                                        ...tdStyle,
                                                                        fontFamily: 'monospace',
                                                                        fontWeight: r.runwayMultiplier !== null && r.runwayMultiplier < 5 ? 700 : 400,
                                                                        color: r.runwayMultiplier !== null && r.runwayMultiplier < 2
                                                                            ? '#ef4444'
                                                                            : r.runwayMultiplier !== null && r.runwayMultiplier < 5
                                                                            ? '#f59e0b'
                                                                            : 'var(--text-secondary)',
                                                                    }}>
                                                                        {runway}
                                                                    </td>
                                                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtSats(r.local)}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                            </table>
                                        </div>
                                     </ChartCard>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CyclesAnalysisPage;
