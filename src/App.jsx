import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Buffer } from 'buffer';
import LNC from '@lightninglabs/lnc-web';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

// Constants and Helpers

// Components
import LoadingSpinner from './components/LoadingSpinner';
import ConnectScreen from './components/ConnectScreen';
import AppHeader from './components/AppHeader';
import DarkModeToggle from './components/DarkModeToggle';
import NavBar from './components/NavBar';
import PeersModal from './components/PeersModal';
import DemoGraphAnalysis from './components/DemoGraphAnalysis';

import GraphAnalysisPage from './pages/GraphAnalysisPage';
import ChannelsPage from './pages/ChannelsPage';

function App() {
  // LNC & Node State
  const [lnc, setLncState] = useState(null);
  const [isPaired, setIsPaired] = useState(() => {
    try {
      return Boolean(new LNC({ namespace: 'tapvolt' })?.credentials?.isPaired);
    } catch (error) {
      console.error('Failed to read LNC pairing state:', error);
      return false;
    }
  });
  const [nodeChannels, setChannels] = useState([]);
  const [nodeInfo, setNodeInfo] = useState(null);

  // Connection Form State
  const [pairingPhrase, setPairingPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [connectionError, setConnectionError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Peers
  const [nodePeers, setNodePeers] = useState();

  const [isPeersModalOpen, setIsPeersModalOpen] = useState(false);

  // UI State
  const [darkMode, setDarkMode] = useState(() => {
    const savedMode = localStorage.getItem('darkMode');
    return savedMode ? JSON.parse(savedMode) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', JSON.stringify(newMode));
  };

  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    const root = document.documentElement;
    const colors = darkMode
      ? {
        '--bg-primary': '#0b1220',
        '--bg-secondary': '#0f172a',
        '--bg-card': '#111c2d',
        '--bg-card-2': '#0b1626',
        '--text-primary': '#e2e8f0',
        '--text-secondary': '#94a3b8',
        '--border-color': '#1f2a3d',
        '--accent-1': '#22d3ee',
        '--accent-2': '#60a5fa',
        '--accent-3': '#fbbf24',
        '--accent-4': '#fb7185',
        '--success-bg': '#064e3b',
        '--success-text': '#34d399',
        '--error-bg': '#4c0519',
        '--error-text': '#fb7185',
        '--form-bg': '#0b1626',
        '--batch-bg': '#0f1a2b',
        '--batch-border': '#1d3557',
        '--input-bg': '#0f1c30',
        '--badge-bg': '#172033',
        '--file-bg': 'rgba(255,255,255,0.08)',
        '--file-hover-bg': 'rgba(255,255,255,0.14)',
        '--file-text': 'var(--text-primary)',
        '--card-shadow': '0 30px 60px -40px rgba(0,0,0,0.65)',
        '--glow-1': 'rgba(34,211,238,0.14)',
        '--glow-2': 'rgba(96,165,250,0.16)',
        '--glow-3': 'rgba(251,191,36,0.16)',
        '--bg-gradient': 'linear-gradient(180deg, #0b1220 0%, #0b1626 100%)',
        '--bg-grid': 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.08) 1px, transparent 0)',
      }
      : {
        '--bg-primary': '#f4f6fb',
        '--bg-secondary': '#fcfdff',
        '--bg-card': '#ffffff',
        '--bg-card-2': '#f8fafc',
        '--text-primary': '#0f172a',
        '--text-secondary': '#5b6b7f',
        '--border-color': '#e2e8f0',
        '--accent-1': '#0ea5a4',
        '--accent-2': '#2563eb',
        '--accent-3': '#f59e0b',
        '--accent-4': '#f43f5e',
        '--success-bg': '#ecfdf3',
        '--success-text': '#0f766e',
        '--error-bg': '#fff1f2',
        '--error-text': '#be123c',
        '--form-bg': '#f1f5f9',
        '--batch-bg': '#eff6ff',
        '--batch-border': '#bfdbfe',
        '--input-bg': '#ffffff',
        '--badge-bg': '#e2e8f0',
        '--file-bg': '#f1f5f9',
        '--file-hover-bg': '#e2e8f0',
        '--file-text': 'var(--text-primary)',
        '--card-shadow': '0 20px 40px -28px rgba(15,23,42,0.35)',
        '--glow-1': 'rgba(14,165,164,0.18)',
        '--glow-2': 'rgba(37,99,235,0.16)',
        '--glow-3': 'rgba(245,158,11,0.18)',
        '--bg-gradient': 'linear-gradient(180deg, #f4f6fb 0%, #eef2f7 100%)',
        '--bg-grid': 'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)',
      };
    Object.entries(colors).forEach(([key, value]) => root.style.setProperty(key, value));
  }, [darkMode]);

  const bytesLikeToHex = useCallback((value) => {
    if (!value) return '';
    try {
      if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('hex');
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (/^[0-9a-f]+$/.test(normalized)) return normalized;
        return Buffer.from(value, 'base64').toString('hex');
      }
    } catch (error) {
      console.error('Failed converting bytes-like value to hex:', error);
    }
    return '';
  }, []);

  const handleConnect = async (event) => {
    event.preventDefault();
    setConnectionError(null);
    setIsConnecting(true);
    try {
      if (!LNC) { throw new Error("LNC constructor not available."); }

      const trimmedPairingPhrase = pairingPhrase.trim();
      const trimmedPassword = password.trim();
      if (!trimmedPairingPhrase) {
        throw new Error('Pairing phrase is required.');
      }
      if (!trimmedPassword) {
        throw new Error('Password is required.');
      }

      const lncInstance = new LNC({ namespace: 'tapvolt' });

      // Clear old credentials before setting the new one to ensure no conflict 
      // from a previous session if the user explicitly typed a new pairing phrase
      if (lncInstance.credentials) {
        lncInstance.credentials.clear();
      }

      lncInstance.credentials.pairingPhrase = trimmedPairingPhrase;
      await lncInstance.connect();
      // Verify node connectivity before persisting encrypted credentials.
      await lncInstance.lnd.lightning.listChannels();
      lncInstance.credentials.password = trimmedPassword;

      setLncState(lncInstance);
      setIsPaired(Boolean(lncInstance?.credentials?.isPaired));
      setPairingPhrase('');
      setPassword('');
    } catch (error) {
      console.error('LNC connection error:', error);
      setConnectionError(error.message || 'Failed to connect. Check phrase/proxy.');
      setLncState(null);
      try {
        setIsPaired(Boolean(new LNC({ namespace: 'tapvolt' })?.credentials?.isPaired));
      } catch (_refreshError) {
        setIsPaired(false);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setConnectionError(null);
    setIsConnecting(true);
    try {
      if (!LNC) { throw new Error("LNC constructor not available."); }
      const trimmedPassword = password.trim();
      if (!trimmedPassword) {
        throw new Error('Password is required.');
      }

      const lncInstance = new LNC({ namespace: 'tapvolt' });
      lncInstance.credentials.password = trimmedPassword;
      if (!lncInstance?.credentials?.isPaired) {
        throw new Error('No paired credentials found. Connect your node first.');
      }

      await lncInstance.connect();

      setLncState(lncInstance);
      setIsPaired(Boolean(lncInstance?.credentials?.isPaired));
      setPassword('');
    } catch (error) {
      console.error('LNC login error:', error);
      setConnectionError(error.message || 'Failed to login. Check password.');
      setLncState(null);
      try {
        setIsPaired(Boolean(new LNC({ namespace: 'tapvolt' })?.credentials?.isPaired));
      } catch (_refreshError) {
        setIsPaired(false);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const getInfo = useCallback(async () => {
    if (!lnc || !lnc.lnd?.lightning) { console.error("LNC or LND lightning service not initialized for getInfo"); return; }
    try { const info = await lnc.lnd.lightning.getInfo(); setNodeInfo(info); }
    catch (error) { console.error("Failed to get node info:", error); setNodeInfo(null); }
  }, [lnc]);

  const listChannels = useCallback(async () => {
    if (!lnc || !lnc.lnd?.lightning) { console.error("LNC or LND lightning service not initialized for listChannels"); return; }
    try {
      const response = await lnc.lnd.lightning.listChannels();
      const channels = Array.isArray(response?.channels) ? response.channels : [];
      setChannels(channels);
    }
    catch (error) {
      console.error("Failed to list channels:", error);
      setChannels([]);
    }
  }, [lnc]);

  const listPeers = useCallback(async () => {
    if (!lnc || !lnc.lnd?.lightning) {
      console.error("LNC or LND lightning service not initialized for listPeers");
      return;
    }
    try {
      const response = await lnc.lnd.lightning.listPeers();
      const peers = Array.isArray(response?.peers) ? response.peers : [];
      const peersWithAliases = await Promise.all(peers.map(async (peer) => {
        let alias = '';
        const pubkey = bytesLikeToHex(peer.pubKey || peer.pub_key || peer.pubkey);
        if (pubkey) {
          try {
            const nodeInfo = await lnc.lnd.lightning.getNodeInfo({ pub_key: pubkey, include_channels: false });
            alias = nodeInfo?.node?.alias || '';
          } catch (e) {
            console.warn("Failed to fetch node info for peer", pubkey);
          }
        }
        return { ...peer, alias, pub_key: pubkey };
      }));
      setNodePeers(peersWithAliases);
    } catch (error) {
      console.error("Failed to list peers:", error);
      setNodePeers([]);
    }
  }, [lnc, bytesLikeToHex]);

  useEffect(() => {
    if (lnc && lnc.isConnected) {
      console.log('LNC ready, fetching node data...');
      getInfo();
      listChannels();
      listPeers();

    } else {
      setNodeInfo(null);
      setChannels([]);
      setNodePeers([]);
    }
  }, [lnc, getInfo, listChannels, listPeers]);

  if (isConnecting && !lnc) {
    return <LoadingSpinner message="Connecting to Node..." />;
  }

  if (!lnc) {
    if (showDemo) {
      return (
        <DemoGraphAnalysis
          darkMode={darkMode}
          onConnect={() => setShowDemo(false)}
        />
      );
    }
    return (
      <ConnectScreen
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        pairingPhrase={pairingPhrase}
        setPairingPhrase={setPairingPhrase}
        password={password}
        setPassword={setPassword}
        isConnecting={isConnecting}
        handleConnect={handleConnect}
        handleLogin={handleLogin}
        onShowPairing={() => setIsPaired(false)}
        connectionError={connectionError}
        isPaired={isPaired}
        onPreview={() => setShowDemo(true)}
      />
    );
  }

  return (
    <HashRouter>
      <div
        className="min-h-screen relative overflow-hidden transition-colors duration-300"
        style={{ background: 'var(--bg-gradient)', color: 'var(--text-primary)' }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full blur-3xl" style={{ background: 'var(--glow-1)' }} />
          <div className="absolute top-10 right-[-10%] h-[28rem] w-[28rem] rounded-full blur-3xl" style={{ background: 'var(--glow-2)' }} />
          <div className="absolute bottom-[-20%] left-[25%] h-80 w-80 rounded-full blur-3xl" style={{ background: 'var(--glow-3)' }} />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'var(--bg-grid)',
              backgroundSize: '22px 22px',
              opacity: darkMode ? 0.35 : 0.55,
            }}
          />
        </div>

        <DarkModeToggle darkMode={darkMode} toggleDarkMode={toggleDarkMode} />

        <div className="relative z-10">
          <div
            className="max-w-6xl mx-auto rounded-3xl shadow-xl transition-all duration-300"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              boxShadow: 'var(--card-shadow)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}`,
              margin: '20px auto 40px',
              backdropFilter: 'blur(12px)',
            }}
          >
            <AppHeader
              nodeInfo={nodeInfo}
              nodeChannelsCount={nodeChannels?.length}
              peersCount={nodePeers?.length}
              onShowPeers={() => setIsPeersModalOpen(true)}
            />

            <NavBar darkMode={darkMode} />

            <Routes>
              <Route path="/graph" element={<GraphAnalysisPage lnc={lnc} darkMode={darkMode} />} />
              <Route path="/channels" element={<ChannelsPage lnc={lnc} darkMode={darkMode} nodeChannels={nodeChannels} />} />
              <Route path="*" element={<Navigate to="/graph" replace />} />
            </Routes>

            <PeersModal
              isOpen={isPeersModalOpen}
              onClose={() => setIsPeersModalOpen(false)}
              peers={nodePeers}
              darkMode={darkMode}
              lnc={lnc}
              onPeerAdded={listPeers}
            />

            <footer
              className="px-6 py-4 border-t text-center text-xs"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              <p>LN Advisor Console</p>
            </footer>
          </div>
        </div>

        <style jsx global>{`
          @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-10px); } 100% { transform: translateY(0px); } }
          @keyframes pulse-slow { 0% { opacity: 0.2; } 50% { opacity: 0.3; } 100% { opacity: 0.2; } }
          .animate-float { animation: float 4s ease-in-out infinite; }
          .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
          body { background: var(--bg-gradient); transition: background 0.3s ease; }
          input[type="file"]::file-selector-button {
            background-color: var(--file-bg);
            color: var(--file-text);
            border: 1px solid ${darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'};
          }
          input[type="file"]::file-selector-button:hover {
            background-color: var(--file-hover-bg);
          }
        `}</style>
      </div>
    </HashRouter>
  );
}

export default App;
