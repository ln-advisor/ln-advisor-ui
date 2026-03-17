import React from 'react';

/**
 * LoginGate — wraps a page's content with a blurred overlay when the user
 * is not authenticated. The underlying page is still rendered (visible but
 * non-interactive) so the user gets a sense of what the page looks like.
 */
const LoginGate = ({ isLoggedIn, onNavigateToConnect, darkMode, children }) => {
  if (isLoggedIn) return children;

  return (
    <div style={{ position: 'relative' }}>
      {/* Dimmed / blurred content underneath */}
      <div style={{
        pointerEvents: 'none',
        userSelect: 'none',
        filter: 'blur(3px) brightness(0.55)',
        opacity: 0.45,
      }}>
        {children}
      </div>

      {/* Overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}>
        <div style={{
          textAlign: 'center',
          padding: '40px 48px',
          borderRadius: 24,
          background: darkMode ? 'rgba(15,23,42,0.84)' : 'rgba(255,255,255,0.88)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
          boxShadow: darkMode
            ? '0 32px 64px rgba(0,0,0,0.5)'
            : '0 32px 64px rgba(15,23,42,0.18)',
          backdropFilter: 'blur(16px)',
          maxWidth: 380,
        }}>
          {/* Icon */}
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 12px 28px rgba(34,211,238,0.3)',
          }}>
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <h3 style={{
            fontSize: 20, fontWeight: 800, color: 'var(--text-primary)',
            letterSpacing: '-0.02em', marginBottom: 10,
          }}>
            Connect to interact
          </h3>
          <p style={{
            fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: 28,
          }}>
            Link your Lightning node via LNC to load live data, run analysis, and get personalised recommendations.
          </p>

          <button
            onClick={onNavigateToConnect}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 26px', borderRadius: 14, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              color: '#fff', fontWeight: 700, fontSize: 14,
              boxShadow: '0 10px 24px rgba(34,211,238,0.35)',
            }}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            Connect Node
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginGate;
