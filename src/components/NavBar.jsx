import React from 'react';
import { NavLink } from 'react-router-dom';

const activeStyle = (darkMode) => ({
  background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
  color: '#ffffff',
  boxShadow: darkMode
    ? '0 8px 20px rgba(34,211,238,0.25)'
    : '0 8px 20px rgba(37,99,235,0.2)',
});
const inactiveStyle = { color: 'var(--text-secondary)', background: 'transparent' };

const NavBar = ({ darkMode, isLoggedIn, onNavigateToConnect }) => {
  const linkBase = `
    relative px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
    flex items-center gap-2
  `;

  const navLink = (to, icon, label, exact = false) => (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        isActive ? `${linkBase} text-white` : `${linkBase} hover:opacity-80`
      }
      style={({ isActive }) => (isActive ? activeStyle(darkMode) : inactiveStyle)}
    >
      {icon}
      {label}
    </NavLink>
  );

  return (
    <nav
      className="flex items-center gap-2 px-6 py-3 border-b transition-colors duration-300"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}
    >
      {/* Node Analysis */}
      {navLink('/graph', (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v6" /><path d="M12 15v6" />
          <path d="M3 12h6" /><path d="M15 12h6" />
          <path d="M5.6 5.6l4.2 4.2" /><path d="M14.2 14.2l4.2 4.2" />
          <path d="M18.4 5.6l-4.2 4.2" /><path d="M9.8 14.2l-4.2 4.2" />
        </svg>
      ), 'Node Analysis')}

      {/* Channel Fees */}
      {navLink('/channels', (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ), 'Channel Fees')}

      {/* Recommendations */}
      {navLink('/recommendations', (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ), 'Opening Recommendations')}

      {/* Cycles Analysis */}
      {navLink('/cycles', (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path d="M12 7v5l3 3" />
        </svg>
      ), 'Cycles Analysis')}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Login button — only when NOT logged in */}
      {!isLoggedIn && onNavigateToConnect && (
        <button
          onClick={onNavigateToConnect}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: darkMode
              ? '0 6px 16px rgba(34,211,238,0.3)'
              : '0 6px 16px rgba(37,99,235,0.22)',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Connect Node
        </button>
      )}
    </nav>
  );
};

export default NavBar;
