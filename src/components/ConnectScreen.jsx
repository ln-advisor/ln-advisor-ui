import React from 'react';
import DarkModeToggle from './DarkModeToggle';
import FeedbackMessage from './FeedbackMessage';

const ConnectScreen = ({
  darkMode,
  toggleDarkMode,
  pairingPhrase,
  setPairingPhrase,
  password,
  setPassword,
  isConnecting,
  handleConnect,
  handleLogin,
  onShowPairing,
  connectionError,
  isPaired,
  onPreview
}) => {
  return (
    <div
      className="flex flex-col justify-center items-center min-h-screen p-4"
      style={{
        background: 'var(--bg-gradient)',
        color: 'var(--text-primary)'
      }}
    >
      <DarkModeToggle
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        className="absolute top-4 right-4"
      />

      <img
        src="/favicon.png"
        alt="LN Advisor Logo"
        className="w-24 h-24 mb-6"
      />

      <div className="text-center mb-8">
        <h1
          className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight font-display"
          style={{ color: 'var(--text-primary)' }}
        >
          LN Advisor
        </h1>
        <p
          className="text-lg md:text-xl max-w-xl leading-relaxed mx-auto"
          style={{ color: darkMode ? '#b4b4b4' : '#4b5563' }}
        >
          {isPaired
            ? 'Login to your previously connected node.'
            : 'Connect your LNC-enabled node.'}
        </p>
      </div>

      <div
        className="bg-opacity-80 backdrop-filter backdrop-blur-lg rounded-2xl shadow-2xl p-8 md:p-10 w-full max-w-md transition-all duration-300"
        style={{
          background: darkMode
            ? 'rgba(17, 28, 45, 0.7)'
            : 'rgba(255, 255, 255, 0.9)',
          boxShadow: 'var(--card-shadow)',
          border: `1px solid ${darkMode
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(15, 23, 42, 0.08)'
            }`
        }}
      >
        <h2
          className="text-2xl font-bold mb-6 text-center"
          style={{ color: 'var(--text-primary)' }}
        >
          {isPaired ? 'Login' : 'Connect Your Node'}
        </h2>

        <form onSubmit={isPaired ? handleLogin : handleConnect}>

          {/* Pairing phrase only shown first time */}
          {!isPaired && (
            <div className="mb-5">
              <label
                className="block text-sm font-bold mb-2"
                style={{ color: 'var(--text-primary)' }}
                htmlFor="pairingPhrase"
              >
                LNC Pairing Phrase
              </label>
              <textarea
                id="pairingPhrase"
                className="w-full px-4 py-3 rounded-lg transition-colors duration-200"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-primary)',
                  border: `1px solid ${darkMode
                    ? 'rgba(255, 255, 255, 0.1)'
                    : 'rgba(0, 0, 0, 0.1)'
                    }`,
                  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.05)'
                }}
                placeholder="Enter pairing phrase..."
                value={pairingPhrase}
                onChange={(e) => setPairingPhrase(e.target.value)}
                required
                rows="4"
                disabled={isConnecting}
              />
            </div>
          )}

          {/* Password field (always required) */}
          <div className="mb-5">
            <label
              className="block text-sm font-bold mb-2"
              style={{ color: 'var(--text-primary)' }}
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="w-full px-4 py-3 rounded-lg transition-colors duration-200"
              style={{
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-primary)',
                border: `1px solid ${darkMode
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'rgba(0, 0, 0, 0.1)'
                  }`,
                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.05)'
              }}
              placeholder="Enter password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isConnecting}
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-bold text-white transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, var(--accent-1), var(--accent-2))`,
              boxShadow: darkMode
                ? '0 4px 12px rgba(34, 211, 238, 0.25)'
                : '0 4px 12px rgba(37, 99, 235, 0.2)'
            }}
            disabled={isConnecting}
          >
            {isConnecting
              ? 'Connecting...'
              : isPaired
                ? 'Login'
                : 'Connect & Save Session'}
          </button>
        </form>

        {isPaired && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onShowPairing}
              className="text-sm transition-colors duration-200"
              style={{ color: 'var(--accent-4)' }}
              disabled={isConnecting}
            >
              Connect a different node
            </button>
          </div>
        )}

        <FeedbackMessage
          type="error"
          message={connectionError}
          darkMode={darkMode}
        />

        <div
          className="mt-8 text-center"
          style={{ color: 'var(--text-secondary)' }}
        >
          <p className="text-sm">
            Powered by Lightning Node Connect
          </p>
          <p className="text-xs mt-2">
            Need help?
            <a
              href="https://docs.lightning.engineering/lightning-network-tools/lightning-node-connect/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 transition-colors duration-200"
              style={{ color: 'var(--accent-2)' }}
            >
              Documentation
            </a>
          </p>
        </div>
        {onPreview && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={onPreview}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'var(--badge-bg)', color: 'var(--text-secondary)' }}
            >
              Preview the dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectScreen;
