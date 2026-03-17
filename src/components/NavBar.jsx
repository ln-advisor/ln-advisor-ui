import React from 'react';
import { NavLink } from 'react-router-dom';

const NavBar = ({ darkMode }) => {
  const linkBase = `
    relative px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
    flex items-center gap-2
  `;

  const activeCls = `${linkBase}`;

  return (
    <nav
      className="flex items-center gap-2 px-6 py-3 border-b transition-colors duration-300"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}
    >
      <NavLink
        to="/graph"
        className={({ isActive }) =>
          isActive
            ? `${activeCls} text-white`
            : `${activeCls} hover:opacity-80`
        }
        style={({ isActive }) =>
          isActive
            ? {
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              color: '#ffffff',
              boxShadow: darkMode
                ? '0 8px 20px rgba(34,211,238,0.25)'
                : '0 8px 20px rgba(37,99,235,0.2)',
            }
            : { color: 'var(--text-secondary)', background: 'transparent' }
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v6" />
          <path d="M12 15v6" />
          <path d="M3 12h6" />
          <path d="M15 12h6" />
          <path d="M5.6 5.6l4.2 4.2" />
          <path d="M14.2 14.2l4.2 4.2" />
          <path d="M18.4 5.6l-4.2 4.2" />
          <path d="M9.8 14.2l-4.2 4.2" />
        </svg>
        Node Analysis
      </NavLink>

      <NavLink
        to="/channels"
        className={({ isActive }) =>
          isActive
            ? `${activeCls} text-white`
            : `${activeCls} hover:opacity-80`
        }
        style={({ isActive }) =>
          isActive
            ? {
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              color: '#ffffff',
              boxShadow: darkMode
                ? '0 8px 20px rgba(34,211,238,0.25)'
                : '0 8px 20px rgba(37,99,235,0.2)',
            }
            : { color: 'var(--text-secondary)', background: 'transparent' }
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        Channel Fees
      </NavLink>

      <NavLink
        to="/recommendations"
        className={({ isActive }) =>
          isActive
            ? `${activeCls} text-white`
            : `${activeCls} hover:opacity-80`
        }
        style={({ isActive }) =>
          isActive
            ? {
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              color: '#ffffff',
              boxShadow: darkMode
                ? '0 8px 20px rgba(34,211,238,0.25)'
                : '0 8px 20px rgba(37,99,235,0.2)',
            }
            : { color: 'var(--text-secondary)', background: 'transparent' }
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Opening Recommendations
      </NavLink>
    </nav>
  );
};

export default NavBar;
