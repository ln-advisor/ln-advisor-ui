import React from 'react';

// ── Tiny SVG helpers ──────────────────────────────────────────────────────
const IconShield = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const IconLock = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const IconBolt = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);
const IconChart = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconKey = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);
const IconArrow = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);
const IconLogin = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </svg>
);
const IconCheck = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── Pipeline step ─────────────────────────────────────────────────────────
const PipelineStep = ({ icon, label, desc, accent, darkMode, last }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
        background: `${accent}1a`,
        border: `2px solid ${accent}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent,
        boxShadow: `0 0 20px ${accent}18`,
      }}>
        {icon}
      </div>
      {!last && (
        <div style={{
          width: 2, flex: 1, minHeight: 28,
          background: `linear-gradient(180deg, ${accent}66, ${accent}11)`,
          margin: '4px 0',
        }} />
      )}
    </div>
    <div style={{ paddingLeft: 18, paddingBottom: last ? 0 : 28 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.12em', color: accent, marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 13.5, color: darkMode ? '#94a3b8' : '#64748b', lineHeight: 1.65 }}>{desc}</div>
    </div>
  </div>
);

// ── Feature card ──────────────────────────────────────────────────────────
const FeatureCard = ({ icon, title, desc, accent, darkMode }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: 'var(--bg-card)',
        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
        borderRadius: 20, padding: '28px 24px',
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered ? `0 24px 40px ${accent}22` : 'none',
        transition: 'transform 0.2s, box-shadow 0.2s',
        cursor: 'default',
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 14, marginBottom: 18,
        background: `${accent}22`,
        border: `1.5px solid ${accent}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>{desc}</div>
    </div>
  );
};

// ── Stat badge ─────────────────────────────────────────────────────────────
const StatBadge = ({ value, label, accent }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{
      fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em',
      background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    }}>{value}</div>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 500 }}>{label}</div>
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────
const HomePage = ({ darkMode, isLoggedIn, onNavigateToConnect }) => {
  const a1 = darkMode ? '#22d3ee' : '#0ea5a4';
  const a2 = darkMode ? '#60a5fa' : '#2563eb';
  const a3 = darkMode ? '#fbbf24' : '#f59e0b';
  const a4 = darkMode ? '#a78bfa' : '#7c3aed';

  const BtnPrimary = ({ children, onClick }) => {
    const [h, setH] = React.useState(false);
    return (
      <button onClick={onClick}
        onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '13px 28px', borderRadius: 14,
          background: `linear-gradient(135deg, ${a1}, ${a2})`,
          color: '#fff', fontWeight: 700, fontSize: 15,
          border: 'none', cursor: 'pointer',
          boxShadow: h ? `0 18px 40px ${a1}55` : `0 10px 28px ${a1}40`,
          transform: h ? 'translateY(-2px)' : 'none',
          transition: 'all 0.18s',
        }}
      >{children}</button>
    );
  };

  const BtnGhost = ({ children, onClick }) => {
    const [h, setH] = React.useState(false);
    return (
      <button onClick={onClick}
        onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '13px 24px', borderRadius: 14,
          background: h ? (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)') : 'transparent',
          color: 'var(--text-primary)', fontWeight: 700, fontSize: 15,
          border: `1.5px solid ${darkMode ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.18)'}`,
          cursor: 'pointer',
          transition: 'all 0.18s',
        }}
      >{children}</button>
    );
  };

  const sep = (
    <div style={{
      width: 1,
      background: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)',
      alignSelf: 'stretch',
    }} />
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 80px' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{ paddingTop: 72, paddingBottom: 72, textAlign: 'center', position: 'relative' }}>
        {/* ambient glow */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 700, height: 280, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${a1}1f 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* Live badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 999,
          background: darkMode ? `${a1}1e` : `${a1}18`,
          border: `1px solid ${a1}44`,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.13em',
          textTransform: 'uppercase', color: a1, marginBottom: 28,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: a1, display: 'inline-block', animation: 'hp-pulse 2s infinite' }} />
          Protected Pipeline · Privacy-First Intelligence
        </div>

        <h1 style={{
          fontSize: 'clamp(34px, 6vw, 70px)', fontWeight: 900,
          letterSpacing: '-0.04em', color: 'var(--text-primary)',
          lineHeight: 1.08, marginBottom: 24,
        }}>
          Lightning Node Intelligence<br />
          <span style={{ background: `linear-gradient(135deg, ${a1}, ${a2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            You Can Actually Trust
          </span>
        </h1>

        <p style={{
          fontSize: 'clamp(15px, 2.2vw, 20px)', color: 'var(--text-secondary)',
          maxWidth: 600, margin: '0 auto 44px', lineHeight: 1.7,
        }}>
          LN Advisor analyzes your node's channels, fees, and routing performance — then
          passes your data through a <strong style={{ color: 'var(--text-primary)' }}>Protected Pipeline</strong> before
          any intelligence reaches an AI model. Your raw keys and balances <em>never</em> leave your device unshielded.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {!isLoggedIn && (
            <BtnPrimary onClick={onNavigateToConnect}>
              <IconLogin /> Connect Your Node
            </BtnPrimary>
          )}
          <BtnGhost onClick={onNavigateToConnect}>
            {isLoggedIn ? 'Open Dashboard' : 'View Dashboard'} <IconArrow />
          </BtnGhost>
        </div>

        {/* Stats row */}
        <div style={{
          marginTop: 64,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          alignItems: 'center', gap: 0,
          backgroundColor: 'var(--bg-card)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)'}`,
          borderRadius: 20, padding: '28px 32px',
        }}>
          <StatBadge value="100%" label="Client-Side Privacy" accent={a1} />
          {sep}
          <StatBadge value="0" label="Raw Keys Transmitted" accent={a2} />
          {sep}
          <StatBadge value="TEE" label="Trusted Execution" accent={a3} />
          {sep}
          <StatBadge value="⚡" label="Lightning Native" accent={a4} />
        </div>
      </section>

      {/* ── PROPS section ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 72 }}>
        <div style={{
          borderRadius: 24,
          background: darkMode
            ? `linear-gradient(135deg, ${a1}0d 0%, ${a2}12 100%)`
            : `linear-gradient(135deg, ${a1}0d 0%, ${a2}0d 100%)`,
          border: `1px solid ${darkMode ? `${a1}33` : `${a1}30`}`,
          padding: 'clamp(28px, 5vw, 52px)',
        }}>
          {/* Label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11,
              background: `${a1}22`, border: `1.5px solid ${a1}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: a1,
            }}><IconShield size={18} /></div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: a1 }}>
              Protected Pipeline (PROPS)
            </span>
          </div>

          <h2 style={{
            fontSize: 'clamp(22px, 4vw, 38px)', fontWeight: 800,
            letterSpacing: '-0.03em', color: 'var(--text-primary)',
            marginBottom: 14, lineHeight: 1.15,
          }}>
            Your data never leaves<br />your device unprotected.
          </h2>

          <p style={{
            fontSize: 15, color: 'var(--text-secondary)',
            maxWidth: 660, lineHeight: 1.72, marginBottom: 36,
          }}>
            PROPS is the core privacy mechanism of LN Advisor. Before any channel data reaches an
            AI intelligence layer, it passes through a{' '}
            <strong style={{ color: 'var(--text-primary)' }}>client-side transformation pipeline</strong>{' '}
            that strips, bands, and anonymizes sensitive identifiers. The pipeline is auditable,
            deterministic, and runs entirely in your browser — no server ever has access to your raw node data.
          </p>

          {/* Pipeline visual */}
          <div style={{
            backgroundColor: darkMode ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.6)',
            borderRadius: 18, padding: '28px 32px',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}`,
            marginBottom: 28,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.16em', color: 'var(--text-secondary)', marginBottom: 22,
            }}>Data Flow</div>
            <PipelineStep
              icon={<IconBolt size={18} />}
              label="1 · Raw Telemetry"
              desc="Your LNC-connected node streams live channel data, balances, peer info, and forwarding statistics. This data stays strictly local in your browser."
              accent={a1} darkMode={darkMode}
            />
            <PipelineStep
              icon={<IconLock size={18} />}
              label="2 · PROPS Filter f(X)"
              desc="The privacy filter anonymizes peer pubkeys into opaque references, bands balance values into privacy buckets, and strips channel IDs — making the payload analytically useful but personally non-identifiable."
              accent={a3} darkMode={darkMode}
            />
            <PipelineStep
              icon={<IconKey size={18} />}
              label="3 · Trusted Execution Environment (TEE)"
              desc="The shielded payload is sent to the Intelligence Layer running inside a Trusted Execution Environment (Phala Network). The code and environment are cryptographically attested — no operator, not even the host, can see or alter the computation."
              accent={a2} darkMode={darkMode}
            />
            <PipelineStep
              icon={<IconChart size={18} />}
              label="4 · Signed AI Recommendations"
              desc="AI analyzes the anonymized snapshot and returns signed, verified fee recommendations and channel opening suggestions. The response includes a cryptographic proof of the pipeline's integrity. Results map back to your real channels client-side."
              accent={a4} darkMode={darkMode} last
            />
          </div>

          {/* Guarantees grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10,
          }}>
            {[
              'Peer pubkeys never transmitted raw',
              'Channel balances rounded to privacy bands',
              'TEE attestation verifiable on-chain',
              'No persistent server-side storage',
              'Client-side mapping restores data post-analysis',
              'Open-source pipeline, fully auditable',
            ].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                <span style={{ color: a1, flexShrink: 0, marginTop: 2 }}><IconCheck /></span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 72 }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: a2, marginBottom: 14 }}>
            What LN Advisor Does
          </div>
          <h2 style={{
            fontSize: 'clamp(22px, 3.5vw, 36px)', fontWeight: 800,
            letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1.2,
          }}>
            Professional-grade node management<br />for serious Lightning operators
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
          <FeatureCard
            icon={<IconChart size={20} />} accent={a1} darkMode={darkMode}
            title="Graph & Network Analysis"
            desc="Visualize the Lightning Network's topology. Explore node centrality, channel capacity distribution, and your node's position using betweenness centrality metrics."
          />
          <FeatureCard
            icon={<IconBolt size={20} />} accent={a2} darkMode={darkMode}
            title="Channel Fee Optimization"
            desc="Analyze fees against routing performance. Review forwarding history, identify underperforming channels, and receive AI-generated fee adjustment recommendations."
          />
          <FeatureCard
            icon={<IconShield size={20} />} accent={a3} darkMode={darkMode}
            title="Privacy-First Intelligence"
            desc="Every recommendation is generated from a PROPS-shielded payload. Your raw node identifiers are anonymized before leaving your browser. Peer pubkeys are never sent to any API."
          />
          <FeatureCard
            icon={<IconKey size={20} />} accent={a4} darkMode={darkMode}
            title="Opening Recommendations"
            desc="Get AI-powered suggestions for new channel openings based on your routing position, traffic patterns, and the broader network topology — with privacy preserved."
          />
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 72 }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <h2 style={{
            fontSize: 'clamp(20px, 3vw, 32px)', fontWeight: 800,
            letterSpacing: '-0.03em', color: 'var(--text-primary)',
          }}>Get Started in Seconds</h2>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
          borderRadius: 22, overflow: 'hidden',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)'}`,
        }}>
          {[
            { step: '01', title: 'Connect via LNC', accent: a1, desc: 'Use your Lightning Node Connect pairing phrase to securely link LN Advisor to your node. No RPC credentials leave your device.' },
            { step: '02', title: 'Fetch Live Data', accent: a2, desc: 'LN Advisor pulls channel states, forwarding history, and graph data directly from your node over the encrypted LNC session.' },
            { step: '03', title: 'Privacy Pipeline Runs', accent: a3, desc: 'PROPS automatically anonymizes sensitive identifiers. The shielded payload is ready for AI analysis without exposing your node\'s identity.' },
            { step: '04', title: 'Receive Insights', accent: a4, desc: 'Get signed, TEE-verified fee recommendations and channel suggestions. Results map back to your real data on the client — privately.' },
          ].map(({ step, title, desc, accent }, i) => (
            <div key={step} style={{
              padding: '32px 26px', backgroundColor: 'var(--bg-card)',
              borderRight: i < 3 ? `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}` : 'none',
            }}>
              <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: '-0.04em', color: accent, opacity: 0.22, marginBottom: 14, lineHeight: 1 }}>{step}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA (only when not logged in) ────────────────────────────────── */}
      {!isLoggedIn && (
        <section>
          <div style={{
            borderRadius: 24,
            background: darkMode
              ? `linear-gradient(135deg, ${a1}1a, ${a2}1a 50%, ${a4}1a)`
              : `linear-gradient(135deg, ${a1}12, ${a2}12 50%, ${a4}12)`,
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
            padding: 'clamp(32px, 6vw, 56px)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: a1, marginBottom: 14 }}>
              Ready to get started?
            </div>
            <h2 style={{
              fontSize: 'clamp(22px, 4vw, 36px)', fontWeight: 800,
              letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: 14, lineHeight: 1.2,
            }}>
              Connect your node.<br />Protect your data.
            </h2>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', maxWidth: 460, margin: '0 auto 32px', lineHeight: 1.65 }}>
              LN Advisor is open-source and runs entirely in your browser. Your node keys, balances, and peer data stay on your device.
            </p>
            <BtnPrimary onClick={onNavigateToConnect}>
              <IconLogin /> Connect Your Node Now
            </BtnPrimary>
          </div>
        </section>
      )}

      <style>{`
        @keyframes hp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
};

export default HomePage;
