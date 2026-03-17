import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBanner from '../components/analysis/ErrorBanner';
import InlineSpinner from '../components/analysis/InlineSpinner';
import ReviewBeforeSendModal from '../components/analysis/ReviewBeforeSendModal';
import SectionBadge from '../components/analysis/SectionBadge';
import { postChannelOpeningRecommendations, postVerify } from '../api/telemetryClient';
import { getPhalaUiConfig, runPhalaVerifiedRecommendation } from '../api/phalaClient';
import { normalizeSnapshot } from '../normalization/normalizeSnapshot';
import { applyPrivacyPolicy } from '../privacy/applyPrivacyPolicy';

const PHALA_UI_CONFIG = getPhalaUiConfig();
const getStandardApiBaseUrl = () => String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const getPhalaTransportBaseUrl = () => import.meta.env.DEV ? '/__phala' : (PHALA_UI_CONFIG.appUrl || '');

const fmtSats = (n) => {
  const num = Number(n) || 0;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return Math.round(num).toLocaleString();
};

const shortHex = (value, size = 24) => {
  if (!value) return '-';
  const text = String(value);
  return text.length <= size ? text : `${text.slice(0, 10)}...${text.slice(-8)}`;
};

const shortHash = (value) => {
  if (!value) return '-';
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-8)}` : text;
};

const jsonByteLength = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
};

const logOpeningDebug = (label, payload) => {
  if (!import.meta.env.DEV) return;
  console.info(`[Opening Recommendations] ${label}`, payload);
};

const buildNodeMetricsState = (metrics = []) => ({
  betweennessCentrality: Object.fromEntries(
    metrics.filter((metric) => metric?.nodePubkey).map((metric) => [String(metric.nodePubkey), metric.betweennessCentrality])
  ),
});

const extractOpeningRecommendations = (response) => {
  const items = response?.recommendation?.channelOpeningRecommendations || response?.recommendationSet?.channelOpeningRecommendations || [];
  return Array.isArray(items) ? items : [];
};

const mapOpeningRecommendations = (items, propsPayload, normalizedSnapshot) => {
  const sortedPeers = [...(normalizedSnapshot?.potentialPeers || [])].sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
  return items.map((item) => {
    const mapped = propsPayload?.potentialPeers?.find((peer) => peer.peerRef === item.peerRef);
    if (!mapped) return item;
    const index = propsPayload.potentialPeers.indexOf(mapped);
    const original = sortedPeers[index];
    return { ...item, alias: original?.alias, pubkey: original?.pubkey };
  });
};

const buildOutgoingInspector = ({ mode, propsPayload, standardResponse = null, phalaResponse = null }) => {
  if (mode === 'phala_verified') {
    const baseUrl = getPhalaTransportBaseUrl();
    const recommendBody = { telemetry: propsPayload };
    const requests = [
      { label: 'Recommend', method: 'POST', endpoint: `${baseUrl}/api/recommend?full=true`, bodyBytes: jsonByteLength(recommendBody), body: recommendBody },
      { label: 'Health', method: 'GET', endpoint: `${baseUrl}/health` },
      { label: 'Info', method: 'GET', endpoint: `${baseUrl}/info?full=true` },
      { label: 'Attestation', method: 'GET', endpoint: `${baseUrl}/attestation?full=true` },
    ];
    if (phalaResponse?.recommend && phalaResponse?.info && phalaResponse?.attestation) {
      const verifyBody = {
        transformedSnapshot: phalaResponse.recommend?.transformedSnapshot,
        recommendationSet: phalaResponse.recommend?.recommendationSet,
        arb: phalaResponse.recommend?.arb,
        sourceReceipt: phalaResponse.recommend?.sourceReceipt,
        liveAppInfo: phalaResponse.info,
        liveAppAttestation: phalaResponse.attestation,
      };
      requests.push({ label: 'Verify', method: 'POST', endpoint: `${baseUrl}/api/verify`, bodyBytes: jsonByteLength(verifyBody), body: verifyBody });
    }
    return { route: 'Verified', transport: import.meta.env.DEV ? 'Browser -> Vite proxy -> verified service' : 'Browser -> verified service', requests };
  }

  const baseUrl = getStandardApiBaseUrl();
  const recommendBody = { propsPayload, privacyMode: 'feature_only' };
  const requests = [
    { label: 'Recommend', method: 'POST', endpoint: `${baseUrl}/api/recommend/channel-openings`, bodyBytes: jsonByteLength(recommendBody), body: recommendBody },
  ];
  if (standardResponse?.arb) {
    const verifyBody = { arb: standardResponse.arb, ...(standardResponse.sourceProvenance ? { sourceProvenance: standardResponse.sourceProvenance } : {}) };
    requests.push({ label: 'Verify', method: 'POST', endpoint: `${baseUrl}/api/verify`, bodyBytes: jsonByteLength(verifyBody), body: verifyBody });
  }
  return { route: 'Standard API', transport: 'Browser -> local API', requests };
};

const DataModal = ({ isOpen, onClose, title, data, darkMode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-3xl border" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border-color)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--text-secondary)' }}>Close</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-6 font-mono text-sm">
          <pre className="whitespace-pre-wrap break-all" style={{ color: darkMode ? '#94a3b8' : '#334155' }}>{JSON.stringify(data, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
};

const RecommendationsPage = ({ lnc, darkMode, mockSnapshot = null }) => {
  const isMockMode = !lnc?.lnd?.lightning && Boolean(mockSnapshot);
  const phalaModeEnabled = PHALA_UI_CONFIG.enabled;
  const phalaModeAvailable = PHALA_UI_CONFIG.available;
  const [analysisMode, setAnalysisMode] = useState(() => (PHALA_UI_CONFIG.available && mockSnapshot ? 'phala_verified' : 'standard'));
  const activeAnalysisMode = isMockMode && phalaModeAvailable ? 'phala_verified' : (phalaModeAvailable && analysisMode === 'phala_verified' ? 'phala_verified' : 'standard');

  const [isLoading, setIsLoading] = useState(false);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [error, setError] = useState(null);
  const [advisorError, setAdvisorError] = useState(null);
  const [graph, setGraph] = useState(null);
  const [nodeInfo, setNodeInfo] = useState(null);
  const [channels, setChannels] = useState([]);
  const [peers, setPeers] = useState([]);
  const [nodeMetrics, setNodeMetrics] = useState(null);
  const [missionControl, setMissionControl] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [verifyResult, setVerifyResult] = useState(null);
  const [phalaRun, setPhalaRun] = useState(null);
  const [pendingPhalaReview, setPendingPhalaReview] = useState(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [pipelineData, setPipelineData] = useState({ rawMetadata: null, normalizedMetadata: null, propsPayload: null, outgoingInspector: null });
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', data: null });

  const loadSnapshotState = useCallback((snapshot) => {
    if (!snapshot) return;
    setNodeInfo(snapshot.nodeInfo || null);
    setChannels(Array.isArray(snapshot.channels) ? snapshot.channels : []);
    setPeers(Array.isArray(snapshot.peers) ? snapshot.peers : []);
    setGraph({ nodes: Array.isArray(snapshot.graphNodes) ? snapshot.graphNodes : [], edges: Array.isArray(snapshot.graphEdges) ? snapshot.graphEdges : [] });
    setNodeMetrics(buildNodeMetricsState(snapshot.nodeCentralityMetrics || []));
    setMissionControl({ pairs: Array.isArray(snapshot.missionControlPairs) ? snapshot.missionControlPairs : [] });
  }, []);

  useEffect(() => {
    if (isMockMode) loadSnapshotState(mockSnapshot);
  }, [isMockMode, loadSnapshotState, mockSnapshot]);

  const executeReviewedPhalaRun = useCallback(async (preparedRun) => {
    if (!preparedRun) return;

    setAdvisorLoading(true);
    setAdvisorError(null);
    setPendingPhalaReview(null);

    try {
      const phalaResponse = await runPhalaVerifiedRecommendation(preparedRun.propsPayload);
      const items = extractOpeningRecommendations(phalaResponse.recommend);
      logOpeningDebug('phala response', {
        recommendOk: phalaResponse?.recommend?.ok,
        openingCount: items.length,
        firstOpening: items[0] || null,
        verifyOk: phalaResponse?.verify?.ok,
        quoteVerified: phalaResponse?.verify?.cloudVerification?.quoteVerified || false,
        verifyErrors: phalaResponse?.verify?.errors || [],
      });
      if (items.length === 0) throw new Error('Verified run returned no opening recommendations.');
      const mapped = mapOpeningRecommendations(items, preparedRun.propsPayload, preparedRun.normalizedSnapshot);
      logOpeningDebug('mapped recommendations', {
        count: mapped.length,
        firstRecommendation: mapped[0] || null,
      });
      setRecommendations(mapped);
      setVerifyResult(phalaResponse.verify);
      setPhalaRun(phalaResponse);
      setPipelineData((prev) => ({ ...prev, outgoingInspector: buildOutgoingInspector({ mode: 'phala_verified', propsPayload: preparedRun.propsPayload, phalaResponse }) }));
    } catch (err) {
      console.error('[Opening Recommendations] advisor failed', err);
      setAdvisorError(err.message || 'Advisor analysis failed.');
      setRecommendations([]);
      setVerifyResult(null);
      setPhalaRun(null);
    } finally {
      setAdvisorLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (isMockMode) {
      loadSnapshotState(mockSnapshot);
      setError(null);
      setAdvisorError(null);
      return;
    }
    if (!lnc?.lnd?.lightning) {
      setError('LNC Session not connected.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setAdvisorError(null);
    try {
      const [info, chans, p, g, metrics, mc] = await Promise.all([
        lnc.lnd.lightning.getInfo({}),
        lnc.lnd.lightning.listChannels({}),
        lnc.lnd.lightning.listPeers({}),
        lnc.lnd.lightning.describeGraph({ include_unannounced: false }),
        lnc.lnd.lightning.getNodeMetrics({ types: ['BETWEENNESS_CENTRALITY'] }),
        lnc.lnd.router.queryMissionControl({}),
      ]);
      setNodeInfo(info || null);
      setChannels(Array.isArray(chans?.channels) ? chans.channels : []);
      setPeers(Array.isArray(p?.peers) ? p.peers : []);
      setGraph(g || { nodes: [], edges: [] });
      setNodeMetrics(metrics || { betweennessCentrality: {} });
      setMissionControl(mc || { pairs: [] });
    } catch (err) {
      console.error('Fetch failed:', err);
      setError(err.message || 'Failed to fetch node data.');
    } finally {
      setIsLoading(false);
    }
  }, [isMockMode, lnc, loadSnapshotState, mockSnapshot]);

  const runAdvisor = useCallback(async () => {
    if ((!lnc?.lnd?.lightning && !isMockMode) || !graph) {
      setAdvisorError('Graph data is required before generating opening recommendations.');
      return;
    }

    setAdvisorLoading(true);
    setAdvisorError(null);
    setVerifyResult(null);
    setPhalaRun(null);
    setPendingPhalaReview(null);
    try {
      logOpeningDebug('run start', {
        isMockMode,
        activeAnalysisMode,
        graphNodes: graph?.nodes?.length || 0,
        graphEdges: graph?.edges?.length || 0,
        channels: channels?.length || 0,
        peers: peers?.length || 0,
        missionControlPairs: missionControl?.pairs?.length || 0,
      });

      const rawMetadata = {
        nodes: graph.nodes?.length || 0,
        edges: graph.edges?.length || 0,
        peers: peers?.length || 0,
        channels: channels?.length || 0,
        missionControlPairs: missionControl?.pairs?.length || 0,
      };
      const normalizedSnapshot = normalizeSnapshot({
        nodeInfo,
        channels,
        peers,
        graphNodes: graph.nodes,
        graphEdges: graph.edges,
        nodeCentralityMetrics: Object.entries(nodeMetrics?.betweennessCentrality || {}).map(([nodePubkey, betweennessCentrality]) => ({ nodePubkey, betweennessCentrality })),
        missionControlPairs: missionControl?.pairs,
        collectedAt: new Date().toISOString(),
      });
      const propsPayload = applyPrivacyPolicy(normalizedSnapshot, 'feature_only');

      logOpeningDebug('normalized snapshot', {
        channels: normalizedSnapshot?.channels?.length || 0,
        peers: normalizedSnapshot?.peers?.length || 0,
        potentialPeers: normalizedSnapshot?.potentialPeers?.length || 0,
        firstPotentialPeer: normalizedSnapshot?.potentialPeers?.[0] || null,
      });

      logOpeningDebug('props payload', {
        channels: propsPayload?.channels?.length || 0,
        peers: propsPayload?.peers?.length || 0,
        potentialPeers: propsPayload?.potentialPeers?.length || 0,
        bodyBytes: jsonByteLength({ telemetry: propsPayload }),
        firstPotentialPeer: propsPayload?.potentialPeers?.[0] || null,
      });

      setPipelineData({ rawMetadata, normalizedMetadata: normalizedSnapshot, propsPayload, outgoingInspector: buildOutgoingInspector({ mode: activeAnalysisMode, propsPayload }) });

      if (activeAnalysisMode === 'phala_verified') {
        setPendingPhalaReview({
          propsPayload,
          normalizedSnapshot,
          outgoingInspector: buildOutgoingInspector({ mode: 'phala_verified', propsPayload }),
        });
        } else {
        const response = await postChannelOpeningRecommendations({ propsPayload, privacyMode: 'feature_only' });
        const items = extractOpeningRecommendations(response);
        logOpeningDebug('standard response', {
          openingCount: items.length,
          firstOpening: items[0] || null,
          hasArb: Boolean(response?.arb),
        });
        if (items.length === 0) throw new Error('Local analysis returned no opening recommendations.');
        const mapped = mapOpeningRecommendations(items, propsPayload, normalizedSnapshot);
        logOpeningDebug('mapped recommendations', {
          count: mapped.length,
          firstRecommendation: mapped[0] || null,
        });
        setRecommendations(mapped);
        setPipelineData((prev) => ({ ...prev, outgoingInspector: buildOutgoingInspector({ mode: activeAnalysisMode, propsPayload, standardResponse: response }) }));
        try {
          const verify = await postVerify(response.arb, response.sourceProvenance);
          logOpeningDebug('standard verify', verify);
          setVerifyResult(verify);
        } catch (verifyError) {
          console.warn('ARB verification failed:', verifyError);
          setVerifyResult({ ok: false, error: verifyError.message });
        }
      }
    } catch (err) {
      console.error('[Opening Recommendations] advisor failed', err);
      setAdvisorError(err.message || 'Advisor analysis failed.');
      setRecommendations([]);
      setVerifyResult(null);
      setPhalaRun(null);
    } finally {
      setAdvisorLoading(false);
    }
  }, [activeAnalysisMode, channels, graph, isMockMode, lnc, missionControl, nodeInfo, nodeMetrics, peers]);

  const stats = useMemo(() => ({
    nodes: graph?.nodes?.length || 0,
    edges: graph?.edges?.length || 0,
    totalCap: (graph?.edges || []).reduce((sum, edge) => sum + (Number(edge.capacity) || 0), 0),
  }), [graph]);

  return (
    <div className="px-6 pb-12 pt-8 space-y-8" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h1 className="text-3xl font-black font-display tracking-tight" style={{ color: 'var(--text-primary)' }}>Opening Recommendations</h1>
              <div className="mt-1 flex items-center gap-2">
                <SectionBadge label="LN Advisor" variant="public" />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Candidate Peer Selection</span>
              </div>
            </div>
          </div>
          <p className="max-w-xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Generate candidate peers from graph data, current channels, and mission control signals.</p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          {phalaModeEnabled && (
            <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
              <button type="button" onClick={() => setAnalysisMode('standard')} className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest" style={{ backgroundColor: activeAnalysisMode === 'standard' ? 'rgba(34,211,238,0.16)' : 'transparent', color: activeAnalysisMode === 'standard' ? 'var(--accent-1)' : 'var(--text-secondary)' }}>Standard</button>
              <button type="button" onClick={() => phalaModeAvailable && setAnalysisMode('phala_verified')} disabled={!phalaModeAvailable} className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${!phalaModeAvailable ? 'opacity-40 cursor-not-allowed' : ''}`} style={{ backgroundColor: activeAnalysisMode === 'phala_verified' ? 'rgba(59,130,246,0.18)' : 'transparent', color: activeAnalysisMode === 'phala_verified' ? '#60a5fa' : 'var(--text-secondary)' }}>Verified</button>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={fetchData} disabled={isMockMode || isLoading} className="px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)', color: 'var(--text-primary)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`, opacity: isMockMode ? 0.7 : 1, cursor: isMockMode ? 'default' : 'pointer' }}>{isLoading && <InlineSpinner size="sm" />}{isMockMode ? 'Mock Graph Loaded' : (isLoading ? 'Syncing...' : 'Sync Graph Data')}</button>
            <button onClick={runAdvisor} disabled={advisorLoading || !graph} className="px-6 py-3 rounded-xl font-bold text-sm text-white" style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))', opacity: (advisorLoading || !graph) ? 0.6 : 1 }}>{advisorLoading ? (activeAnalysisMode === 'phala_verified' ? 'Running verified analysis...' : 'Running analysis...') : (activeAnalysisMode === 'phala_verified' ? 'Review Request' : 'Generate Recommendations')}</button>
          </div>
          {isMockMode && (
            <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Mock graph data is preloaded for this page.
            </div>
          )}
        </div>
      </div>

      <ErrorBanner message={error || advisorError} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}><div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>Network Nodes</div><div className="mt-2 text-3xl font-bold" style={{ color: 'var(--accent-2)' }}>{stats.nodes.toLocaleString()}</div></div>
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}><div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>Network Edges</div><div className="mt-2 text-3xl font-bold" style={{ color: 'var(--accent-1)' }}>{stats.edges.toLocaleString()}</div></div>
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}><div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>Total Capacity</div><div className="mt-2 text-3xl font-bold" style={{ color: 'var(--accent-3)' }}>{fmtSats(stats.totalCap)}</div></div>
      </div>

      {(recommendations.length > 0 || verifyResult || phalaRun) && (
        <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--bg-card)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}` }}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Analysis Route</span><span className="font-mono text-xs" style={{ color: activeAnalysisMode === 'phala_verified' ? '#60a5fa' : 'var(--text-primary)' }}>{activeAnalysisMode === 'phala_verified' ? 'Verified' : 'Standard API'}</span></div>
            <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Verification</span><span className="font-mono text-xs" style={{ color: verifyResult?.ok ? '#22c55e' : '#f97316' }}>{verifyResult ? (verifyResult.ok ? 'Verified' : 'Verification failed') : 'Pending'}</span></div>
            <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Candidates</span><span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{recommendations.length}</span></div>
          </div>
          {phalaRun && (
            <div className="rounded-xl p-4" style={{ backgroundColor: darkMode ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)', border: `1px solid ${darkMode ? 'rgba(96,165,250,0.18)' : 'rgba(59,130,246,0.14)'}` }}>
              <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-blue-400">Verification Status</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-[11px]">
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Signer</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{shortHash(verifyResult?.signerPolicy?.providerRuntimeId || verifyResult?.signerPolicy?.allowedSignerProviderId)}</span></div>
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Signer Type</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{verifyResult?.signerPolicy?.expectedSignerProviderType || '-'}</span></div>
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Runtime Check</span><span className="font-mono" style={{ color: phalaRun?.verify?.cloudVerification?.quoteVerified ? '#22c55e' : '#f97316' }}>{phalaRun?.verify?.cloudVerification?.quoteVerified ? 'Cloud verified' : 'Unavailable'}</span></div>
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Measurement</span><span className="font-mono" style={{ color: phalaRun?.health?.measurementPolicy?.pinned ? '#22c55e' : '#f97316' }}>{phalaRun?.health?.measurementPolicy?.pinned ? shortHash(phalaRun?.health?.measurementPolicy?.allowedMeasurement) : 'Not pinned'}</span></div>
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Runtime Source</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{phalaRun?.health?.attestationSource || '-'}</span></div>
                <div className="flex items-center justify-between"><span style={{ color: 'var(--text-secondary)' }}>Live Verification</span><span className="font-mono" style={{ color: verifyResult?.liveAppEvidencePolicy?.requireLiveAppEvidence ? '#22c55e' : 'var(--text-secondary)' }}>{verifyResult?.liveAppEvidencePolicy?.requireLiveAppEvidence ? 'Required' : 'Optional'}</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>Top Recommendations</h2>
          {recommendations.length > 0 && <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{recommendations.length} Suggestions Found</span>}
        </div>
        {advisorLoading && <div className="py-12 text-center text-sm font-bold text-cyan-500">Processing graph centrality and mission logs...</div>}
        {!advisorLoading && recommendations.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">{recommendations.map((rec) => <div key={rec.pubkey || rec.peerRef} className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}><div className="flex items-start justify-between gap-4"><div><div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{rec.alias || 'Unknown Node'}</div><div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{rec.pubkey ? shortHex(rec.pubkey, 24) : shortHex(rec.peerRef, 24)}</div></div><div className="text-right"><div className="text-2xl font-black" style={{ color: rec.score > 500 ? 'var(--accent-1)' : rec.score > 200 ? 'var(--accent-2)' : 'var(--accent-3)' }}>{Math.round(rec.score)}</div><div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Score</div></div></div><div className="mt-4 flex flex-wrap gap-2">{(rec.reasons || []).map((reason, index) => <span key={`${rec.peerRef || rec.pubkey}-${index}`} className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase" style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)', color: 'var(--text-primary)' }}>{String(reason).replace(/_/g, ' ')}</span>)}</div><div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }}><div className="text-center"><div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Centrality</div><div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{rec.signals?.centralityBand || '-'}</div></div><div className="text-center"><div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Reliability</div><div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{rec.signals?.reliabilityBand || '-'}</div></div><div className="text-center"><div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Capacity</div><div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{rec.signals?.capacityBand || '-'}</div></div></div></div>)}</div>}
        {!advisorLoading && recommendations.length === 0 && !error && !advisorError && <div className="rounded-3xl p-16 text-center" style={{ backgroundColor: 'var(--bg-card)', border: `2px dashed ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)'}` }}><div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>No Recommendations Yet</div><div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Load graph data first, then generate opening recommendations for candidate peers.</div></div>}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3"><h2 className="text-xl font-bold font-display" style={{ color: 'var(--text-primary)' }}>Request Inspector</h2><span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-indigo-500">Inspector</span></div>
          <button onClick={() => setShowPipeline((value) => !value)} className="text-xs font-bold uppercase tracking-widest text-cyan-500">{showPipeline ? 'Hide Inspector' : 'Show Inspector'}</button>
        </div>
        {showPipeline && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"><div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}><div className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Stage 1: Raw</div><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Nodes</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.nodes || 0}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Edges</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.edges || 0}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Mission Control</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.rawMetadata?.missionControlPairs || 0}</span></div></div>{pipelineData.rawMetadata && <button className="mt-4 w-full rounded-lg bg-amber-500/10 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-500" onClick={() => setModalConfig({ isOpen: true, title: 'Stage 1: Raw LND Extraction', data: pipelineData.rawMetadata })}>View Raw Data</button>}</div><div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}><div className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Stage 2: Normalized</div><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Channels</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.normalizedMetadata?.channels?.length || 0}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Peers</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.normalizedMetadata?.peers?.length || 0}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Potential Peers</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.normalizedMetadata?.potentialPeers?.length || 0}</span></div></div>{pipelineData.normalizedMetadata && <button className="mt-4 w-full rounded-lg bg-blue-500/10 py-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-500" onClick={() => setModalConfig({ isOpen: true, title: 'Stage 2: Normalized Node State', data: pipelineData.normalizedMetadata })}>View Normalized</button>}</div><div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}><div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Stage 3: Final Payload</div><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Privacy Mode</span><span className="font-mono font-bold text-emerald-500">FEATURE_ONLY</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Channels</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.propsPayload?.channels?.length || 0}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Potential Peers</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.propsPayload?.potentialPeers?.length || 0}</span></div></div>{pipelineData.propsPayload && <button className="mt-4 w-full rounded-lg bg-emerald-500/10 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500" onClick={() => setModalConfig({ isOpen: true, title: 'Stage 3: Outgoing Payload', data: pipelineData.propsPayload })}>Inspect Payload</button>}</div><div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}><div className="text-[10px] font-bold uppercase tracking-widest text-violet-500">Stage 4: Outgoing Requests</div><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Route</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.route || '-'}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Transport</span><span className="font-mono text-right" style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.transport || '-'}</span></div><div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Requests</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{pipelineData.outgoingInspector?.requests?.length || 0}</span></div></div>{pipelineData.outgoingInspector && <button className="mt-4 w-full rounded-lg bg-violet-500/10 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-500" onClick={() => setModalConfig({ isOpen: true, title: 'Stage 4: Network Requests', data: pipelineData.outgoingInspector })}>Inspect Requests</button>}</div></div>}
      </div>

      <DataModal isOpen={modalConfig.isOpen} onClose={() => setModalConfig({ ...modalConfig, isOpen: false })} title={modalConfig.title} data={modalConfig.data} darkMode={darkMode} />
      <ReviewBeforeSendModal
        isOpen={Boolean(pendingPhalaReview)}
        onClose={() => setPendingPhalaReview(null)}
        onConfirm={() => executeReviewedPhalaRun(pendingPhalaReview)}
        darkMode={darkMode}
        title="Review Opening Recommendation Request"
        requestPlan={pendingPhalaReview?.outgoingInspector || null}
        sending={advisorLoading}
      />
    </div>
  );
};

export default RecommendationsPage;
