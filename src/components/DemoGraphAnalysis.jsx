import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
  ScatterChart, Scatter, ZAxis,
  PieChart, Pie, Cell,
  ComposedChart, Line,
} from 'recharts';

const StatCard = ({ title, value, sub, color, darkMode }) => (
  <div
    className="rounded-xl p-5 flex flex-col gap-2 transition-colors duration-300"
    style={{
      backgroundColor: 'var(--bg-card)',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
      boxShadow: 'var(--card-shadow)',
    }}
  >
    <div className="h-1 w-12 rounded-full" style={{ background: color || 'var(--accent-1)' }} />
    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
      {title}
    </p>
    <p className="text-2xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
    {sub && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
  </div>
);

const ChartCard = ({ title, subtitle, darkMode, children }) => (
  <div
    className="rounded-xl overflow-hidden transition-colors duration-300"
    style={{
      backgroundColor: 'var(--bg-card)',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
      boxShadow: 'var(--card-shadow)',
    }}
  >
    <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent-1), var(--accent-2))' }} />
    <div className="p-4 border-b" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}>
      <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {subtitle && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const DemoGraphAnalysis = ({ darkMode, onConnect }) => {
  const chartTheme = useMemo(() => {
    const axis = darkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
    const grid = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const tooltipBg = darkMode ? '#0b1220' : '#ffffff';
    const tooltipBorder = darkMode ? '#334155' : '#e5e7eb';
    return { axis, grid, tooltipBg, tooltipBorder };
  }, [darkMode]);

  const forwardingKpis = {
    total: 1284,
    fees: '92.4k',
    inbound: '38.6M',
    outbound: '37.9M',
  };

  const forwardingTop = [
    { label: 'River ↔ Nova', direction: 'Inbound', count: 214, fees: '12.4k', avgFee: 58, lastSeen: '2h ago' },
    { label: 'VoltHub ↔ DeepNode', direction: 'Outbound', count: 188, fees: '10.1k', avgFee: 54, lastSeen: '4h ago' },
    { label: 'Horizon ↔ River', direction: 'Inbound', count: 162, fees: '8.2k', avgFee: 50, lastSeen: '7h ago' },
  ];

  const recencyData = [
    { label: '≤1h', success: 12, fail: 4 },
    { label: '≤24h', success: 48, fail: 18 },
    { label: '≤7d', success: 96, fail: 42 },
    { label: '≤30d', success: 110, fail: 64 },
    { label: '>30d', success: 34, fail: 40 },
  ];

  const statusPie = [
    { name: 'Success only', value: 420, color: 'var(--accent-1)' },
    { name: 'Fail only', value: 210, color: 'var(--accent-3)' },
    { name: 'Both', value: 380, color: 'var(--accent-2)' },
    { name: 'No data', value: 96, color: '#94a3b8' },
  ];

  const mcScatter = [
    { success: 1200, fail: 220 },
    { success: 860, fail: 340 },
    { success: 420, fail: 90 },
    { success: 1480, fail: 520 },
    { success: 620, fail: 180 },
  ];

  const strongPairs = [
    { from: 'River', to: 'VoltHub', score: 1.82 },
    { from: 'Nova', to: 'Horizon', score: 1.64 },
    { from: 'DeepNode', to: 'River', score: 1.42 },
  ];

  const weakPairs = [
    { from: 'Nova', to: 'DeepNode', score: -0.62 },
    { from: 'Horizon', to: 'VoltHub', score: -0.44 },
    { from: 'River', to: 'NorthGate', score: -0.31 },
  ];

  const topPairs = [
    { from: 'River', to: 'VoltHub', success: '9.4M', fail: '0.6M', lastSuccess: '3h', lastFail: '2d', score: 1.82 },
    { from: 'Nova', to: 'Horizon', success: '7.1M', fail: '0.8M', lastSuccess: '5h', lastFail: '3d', score: 1.64 },
    { from: 'DeepNode', to: 'River', success: '5.6M', fail: '0.5M', lastSuccess: '8h', lastFail: '5d', score: 1.42 },
  ];

  const centralityNodes = [
    { node: 'VoltHub', value: 0.003214, normalized: 0.88 },
    { node: 'River', value: 0.002901, normalized: 0.79 },
    { node: 'Horizon', value: 0.002540, normalized: 0.71 },
    { node: 'Nova', value: 0.002120, normalized: 0.62 },
  ];

  const topNodes = [
    { label: 'River', channels: 82, capacity: 420 },
    { label: 'DeepNode', channels: 64, capacity: 310 },
    { label: 'Horizon', channels: 58, capacity: 280 },
    { label: 'VoltHub', channels: 51, capacity: 240 },
    { label: 'Nova', channels: 46, capacity: 210 },
  ];

  const feeBuckets = [
    { label: '0–100', channels: 38, medianBase: 120 },
    { label: '100–500', channels: 64, medianBase: 220 },
    { label: '500–1k', channels: 52, medianBase: 340 },
    { label: '1k–5k', channels: 31, medianBase: 620 },
    { label: '5k–10k', channels: 14, medianBase: 980 },
    { label: '≥10k', channels: 6, medianBase: 1450 },
  ];

  const capacityBuckets = [
    { label: '<1M', count: 28 },
    { label: '1–5M', count: 64 },
    { label: '5–10M', count: 42 },
    { label: '10–50M', count: 38 },
    { label: '50–100M', count: 18 },
    { label: '≥100M', count: 6 },
  ];

  const scatterData = [
    { cap: 820, ppm: 120 },
    { cap: 640, ppm: 420 },
    { cap: 1200, ppm: 220 },
    { cap: 340, ppm: 980 },
    { cap: 980, ppm: 520 },
    { cap: 440, ppm: 1800 },
    { cap: 1500, ppm: 280 },
    { cap: 740, ppm: 760 },
    { cap: 220, ppm: 180 },
  ];

  return (
    <div
      className="px-6 pb-12 pt-8 space-y-10"
      style={{ maxWidth: 1280, margin: '0 auto', color: 'var(--text-primary)' }}
    >
      <div className="flex items-start justify-between flex-wrap gap-6">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
            <span className="px-2.5 py-1 rounded-full" style={{ background: 'rgba(14,165,164,0.14)', color: 'var(--accent-1)' }}>
              Graph Data
            </span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: 'rgba(37,99,235,0.16)', color: 'var(--accent-2)' }}>
              Node Data
            </span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: 'var(--badge-bg)', color: 'var(--text-secondary)' }}>
              Verified Results
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold font-display mt-3" style={{ color: 'var(--text-primary)' }}>
            LN Advisor Preview
          </h2>
          <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>
            Preview the dashboard after connecting your node. It combines graph data, node activity, and verified results.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5 text-sm">
            {[
              'Channel recommendations for fee and liquidity review',
              'Opening recommendations from graph and routing signals',
              'Peer reliability and liquidity context',
              'Request review and verification details',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full" style={{ background: 'var(--accent-1)' }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={onConnect}
          className="px-5 py-3 rounded-xl text-sm font-semibold text-white"
          style={{
            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
            boxShadow: darkMode ? '0 8px 18px rgba(34,211,238,0.25)' : '0 8px 18px rgba(37,99,235,0.2)',
          }}
        >
          Connect Node
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Nodes" value="4,182" color="var(--accent-2)" darkMode={darkMode} />
        <StatCard title="Channels" value="15,407" color="var(--accent-1)" darkMode={darkMode} />
        <StatCard title="Total Capacity" value="7.3B sats" color="var(--accent-3)" darkMode={darkMode} sub="Avg 475k / channel" />
        <StatCard title="Disabled Policies" value="18.2%" color="var(--accent-4)" darkMode={darkMode} sub="P95 fee 980 ppm" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Top nodes by channel count" subtitle="Connectivity + adjacent capacity (M sats)" darkMode={darkMode}>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={topNodes} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis yAxisId="left" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)', paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="channels" fill="var(--accent-2)" radius={[6, 6, 0, 0]} name="Channels" />
                <Line yAxisId="right" type="monotone" dataKey="capacity" stroke="var(--accent-3)" dot={false} strokeWidth={2} name="Capacity (M sats)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Fee rate vs. Fee base" subtitle="Bars = channels · Line = median fee base (msat)" darkMode={darkMode}>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={feeBuckets} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)', paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="channels" fill="var(--accent-3)" radius={[4, 4, 0, 0]} name="# Channels" />
                <Line yAxisId="right" type="monotone" dataKey="medianBase" stroke="var(--accent-1)" strokeWidth={2} dot={{ r: 3 }} name="Median base (msat)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Channel capacity distribution" subtitle="Number of channels per bucket (sats)" darkMode={darkMode}>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={capacityBuckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                <Bar dataKey="count" fill="var(--accent-1)" radius={[6, 6, 0, 0]} name="Channels" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Capacity vs. Fee rate (scatter)" subtitle="Each dot = one channel direction" darkMode={darkMode}>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="cap" name="Capacity (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                <YAxis dataKey="ppm" name="Fee rate (ppm)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                <ZAxis range={[12, 12]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }}
                />
                <Scatter data={scatterData} fill="var(--accent-2)" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Forwarding Intelligence" subtitle="Private forwarding history · last 7 days" darkMode={darkMode}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="Forwards" value={forwardingKpis.total.toLocaleString()} color="var(--accent-2)" darkMode={darkMode} />
          <StatCard title="Fees Earned" value={`${forwardingKpis.fees} sats`} color="var(--accent-1)" darkMode={darkMode} />
          <StatCard title="Inbound Volume" value={`${forwardingKpis.inbound} sats`} color="var(--accent-3)" darkMode={darkMode} />
          <StatCard title="Outbound Volume" value={`${forwardingKpis.outbound} sats`} color="var(--accent-4)" darkMode={darkMode} />
        </div>
        <div className="text-xs uppercase tracking-widest font-semibold mt-4" style={{ color: 'var(--text-secondary)' }}>
          Top channels by fee (mapped to graph)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>Channel</th>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>Direction</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Forwards</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Fees</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Avg Fee</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {forwardingTop.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.label}</td>
                  <td style={{ padding: '8px 6px', color: 'var(--text-primary)' }}>{row.direction}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.count}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.fees} sats</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.avgFee} sats</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>{row.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard title="Mission Control Intelligence" subtitle="Path reliability signals from router history" darkMode={darkMode}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="Pairs tracked" value="1,470" color="var(--accent-2)" darkMode={darkMode} />
          <StatCard title="Pairs with success" value="1,040" color="var(--accent-1)" darkMode={darkMode} sub="92 in 7d" />
          <StatCard title="Pairs with failure" value="694" color="var(--accent-3)" darkMode={darkMode} sub="58 in 7d" />
          <StatCard title="Signal balance" value="1,734" color="var(--accent-4)" darkMode={darkMode} sub="Success + fail pairs" />
        </div>
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Recency distribution" subtitle="How fresh are success and failure signals?" darkMode={darkMode}>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={recencyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTheme.axis, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                <Bar dataKey="success" fill="var(--accent-1)" radius={[6, 6, 0, 0]} name="Success" />
                <Bar dataKey="fail" fill="var(--accent-3)" radius={[6, 6, 0, 0]} name="Failure" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Signal coverage" subtitle="What share of pairs have success/failure history?" darkMode={darkMode}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-center">
            <div style={{ width: '100%', height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {statusPie.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-sm">
              {statusPie.map((row) => (
                <div key={row.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                    {row.name}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{row.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Success vs failure amounts" subtitle="Each dot = one pair history (k sats)" darkMode={darkMode}>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="success" name="Success (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                <YAxis dataKey="fail" name="Fail (k sats)" type="number" tick={{ fill: chartTheme.axis, fontSize: 10 }} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 10 }} />
                <Scatter data={mcScatter} fill="var(--accent-2)" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Top + weak pairs" subtitle="Score blends success recency and failure penalty" darkMode={darkMode}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Strong pairs</div>
              {strongPairs.map((row) => (
                <div key={`${row.from}-${row.to}`} className="flex items-center justify-between">
                  <span>{row.from} → {row.to}</span>
                  <span className="font-mono" style={{ color: 'var(--accent-1)' }}>{row.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Weak pairs</div>
              {weakPairs.map((row) => (
                <div key={`${row.from}-${row.to}`} className="flex items-center justify-between">
                  <span>{row.from} → {row.to}</span>
                  <span className="font-mono" style={{ color: 'var(--accent-4)' }}>{row.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Pairs (top 200)" subtitle="Mission control pair history" darkMode={darkMode}>
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>From</th>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>To</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Success amt</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Fail amt</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Last success</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Last fail</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {topPairs.map((row) => (
                <tr key={`${row.from}-${row.to}`}>
                  <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.from}</td>
                  <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.to}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.success} msat</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--accent-3)' }}>{row.fail} msat</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>{row.lastSuccess}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>{row.lastFail}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--accent-1)' }}>{row.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard title="Graph Influence (Betweenness Centrality)" subtitle="Public graph signal · top nodes by centrality" darkMode={darkMode}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>Node</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Centrality</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>Normalized</th>
              </tr>
            </thead>
            <tbody>
              {centralityNodes.map((row) => (
                <tr key={row.node}>
                  <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.node}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.value.toFixed(6)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{row.normalized.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
};

export default DemoGraphAnalysis;
