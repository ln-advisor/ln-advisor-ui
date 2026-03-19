import React, { useEffect, useMemo, useState } from 'react';
import {
  getConditionalRecallSessionResult,
  getConditionalRecallSessionStatus,
  postConditionalRecallConfigTest,
  postConditionalRecallSessionCancel,
  postConditionalRecallSessionStart,
} from '../api/telemetryClient';
import { conditionalRecallDebugLog } from '../cr/debug';

const STORAGE_KEY = 'lnadvisor.conditionalRecall.settings';
const MOCK_REST_HOST = 'mock-lightning.local';
const MOCK_MACAROON = 'mock-conditional-recall';

const readText = (value) => String(value ?? '').trim();

const readChannelId = (channel) =>
  readText(channel?.chanId || channel?.chan_id || channel?.channelId || channel?.channel_id);

const readRemoteLabel = (channel, index) => {
  const alias = readText(channel?.peerAlias || channel?.peer_alias || channel?.alias);
  if (alias) return alias;
  const remotePubkey = readText(channel?.remotePubkey || channel?.remote_pubkey);
  if (!remotePubkey) return `channel ${index + 1}`;
  return remotePubkey.length > 16
    ? `${remotePubkey.slice(0, 8)}…${remotePubkey.slice(-6)}`
    : remotePubkey;
};

const readNodePubkey = (info) =>
  readText(info?.identityPubkey || info?.identity_pubkey).toLowerCase();

const readPolicyPpm = (policy) => {
  const raw = policy?.feeRateMilliMsat ?? policy?.fee_rate_milli_msat ?? policy?.feeRatePpm ?? policy?.fee_rate_ppm;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number.parseFloat(raw.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const defaultFormState = {
  restHost: '',
  macaroonHex: '',
  allowSelfSigned: false,
  lookbackDays: 14,
  liveWindowSeconds: 300,
};

const loadInitialFormState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFormState;
    const parsed = JSON.parse(raw);
    return {
      ...defaultFormState,
      restHost: readText(parsed?.restHost),
      allowSelfSigned: parsed?.allowSelfSigned === true,
      lookbackDays: Number(parsed?.lookbackDays) > 0 ? Number(parsed.lookbackDays) : 14,
      liveWindowSeconds: Number(parsed?.liveWindowSeconds) > 0 ? Number(parsed.liveWindowSeconds) : 300,
      macaroonHex: '',
    };
  } catch (_error) {
    return defaultFormState;
  }
};

const fmtNum = (value) => Number(value || 0).toLocaleString();
const fmtPct = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const StatusPill = ({ state }) => {
  const palette = {
    idle: { bg: 'rgba(148,163,184,0.14)', color: 'var(--text-secondary)' },
    testing_config: { bg: 'rgba(59,130,246,0.14)', color: 'var(--accent-2)' },
    starting: { bg: 'rgba(59,130,246,0.14)', color: 'var(--accent-2)' },
    collecting_history: { bg: 'rgba(59,130,246,0.14)', color: 'var(--accent-2)' },
    streaming_live: { bg: 'rgba(34,197,94,0.14)', color: 'var(--success-text)' },
    analyzing: { bg: 'rgba(250,204,21,0.14)', color: 'var(--accent-3)' },
    completed: { bg: 'rgba(34,197,94,0.14)', color: 'var(--success-text)' },
    failed: { bg: 'rgba(244,63,94,0.14)', color: 'var(--error-text)' },
    canceled: { bg: 'rgba(244,63,94,0.14)', color: 'var(--error-text)' },
  };
  const colors = palette[state] || palette.idle;
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
      style={{ background: colors.bg, color: colors.color }}
    >
      {String(state || 'idle').replace(/_/g, ' ')}
    </span>
  );
};

const SectionCard = ({ title, subtitle, right, children }) => (
  <section
    className="rounded-2xl border p-6"
    style={{
      backgroundColor: 'var(--bg-card)',
      borderColor: 'var(--border-color)',
      boxShadow: 'var(--card-shadow)',
    }}
  >
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const ExplainerTile = ({ title, body }) => (
  <div
    className="rounded-xl border p-4"
    style={{
      borderColor: 'var(--border-color)',
      backgroundColor: 'var(--bg-card-2)',
    }}
  >
    <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>
      {title}
    </p>
    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
      {body}
    </p>
  </div>
);

const ConditionalRecallPage = ({ lnc, darkMode, nodeChannels = [], mockSnapshot = null }) => {
  const isMockMode = !lnc?.lnd?.lightning && Boolean(mockSnapshot);
  const [formState, setFormState] = useState(loadInitialFormState);
  const [feePpmByChannelId, setFeePpmByChannelId] = useState({});
  const [feePpmLoading, setFeePpmLoading] = useState(false);
  const [configTest, setConfigTest] = useState(null);
  const [configTestError, setConfigTestError] = useState(null);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionResult, setSessionResult] = useState(null);
  const [pageError, setPageError] = useState(null);

  useEffect(() => {
    const persisted = {
      restHost: formState.restHost,
      allowSelfSigned: formState.allowSelfSigned,
      lookbackDays: formState.lookbackDays,
      liveWindowSeconds: formState.liveWindowSeconds,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [formState.restHost, formState.allowSelfSigned, formState.lookbackDays, formState.liveWindowSeconds]);

  useEffect(() => {
    if (!isMockMode) return;
    conditionalRecallDebugLog('mock mode enabled', {
      restHost: MOCK_REST_HOST,
    });
    setFormState((current) => ({
      ...current,
      restHost: current.restHost || MOCK_REST_HOST,
      macaroonHex: current.macaroonHex || MOCK_MACAROON,
      liveWindowSeconds: current.liveWindowSeconds || 30,
    }));
  }, [isMockMode]);

  useEffect(() => {
    let cancelled = false;

    const loadFeeHints = async () => {
      if (isMockMode && mockSnapshot) {
        const localPubkey = readNodePubkey(mockSnapshot.nodeInfo);
        const feePolicies = Array.isArray(mockSnapshot.feePolicies) ? mockSnapshot.feePolicies : [];
        const nextFeeMap = Object.fromEntries(
          feePolicies
            .filter((policy) => readText(policy.directionPubKey || policy.direction_pub_key).toLowerCase() === localPubkey)
            .map((policy) => [readText(policy.channelId || policy.channel_id), readPolicyPpm(policy)])
        );
        conditionalRecallDebugLog('loaded mock fee hints', {
          channelCount: Array.isArray(mockSnapshot.channels) ? mockSnapshot.channels.length : 0,
          feeHintCount: Object.keys(nextFeeMap).length,
        });
        setFeePpmByChannelId(nextFeeMap);
        setFeePpmLoading(false);
        return;
      }

      if (!lnc?.lnd?.lightning || !Array.isArray(nodeChannels) || nodeChannels.length === 0) {
        setFeePpmByChannelId({});
        return;
      }

      setFeePpmLoading(true);
      try {
        const info = await lnc.lnd.lightning.getInfo({});
        const localPubkey = readNodePubkey(info);
        const entries = await Promise.all(
          nodeChannels.map(async (channel) => {
            const channelId = readChannelId(channel);
            if (!channelId) return [channelId, null];

            try {
              const chanInfo = await lnc.lnd.lightning.getChanInfo({ chan_id: channelId });
              const node1Pub = readText(chanInfo?.node1_pub || chanInfo?.node1Pub).toLowerCase();
              const node2Pub = readText(chanInfo?.node2_pub || chanInfo?.node2Pub).toLowerCase();
              const myPolicy =
                node1Pub === localPubkey
                  ? chanInfo?.node1_policy || chanInfo?.node1Policy
                  : node2Pub === localPubkey
                    ? chanInfo?.node2_policy || chanInfo?.node2Policy
                    : null;
              return [channelId, readPolicyPpm(myPolicy)];
            } catch (_error) {
              return [channelId, null];
            }
          })
        );

        if (!cancelled) {
          setFeePpmByChannelId(Object.fromEntries(entries.filter(([channelId]) => channelId)));
          conditionalRecallDebugLog('loaded live fee hints', {
            channelCount: Array.isArray(nodeChannels) ? nodeChannels.length : 0,
            feeHintCount: entries.filter(([, fee]) => fee !== null && fee !== undefined).length,
          });
        }
      } catch (_error) {
        if (!cancelled) {
          setFeePpmByChannelId({});
        }
      } finally {
        if (!cancelled) {
          setFeePpmLoading(false);
        }
      }
    };

    void loadFeeHints();
    return () => {
      cancelled = true;
    };
  }, [isMockMode, lnc, mockSnapshot, nodeChannels]);

  const channelHints = useMemo(
    () =>
      (Array.isArray(nodeChannels) ? nodeChannels : [])
        .map((channel, index) => {
          const channelId = readChannelId(channel);
          if (!channelId) return null;
          const label = readRemoteLabel(channel, index);
          return {
            channelId,
            channelRef: `channel_${String(index + 1).padStart(4, '0')}`,
            label,
            currentFeePpm:
              feePpmByChannelId[channelId] === null || feePpmByChannelId[channelId] === undefined
                ? null
                : Number(feePpmByChannelId[channelId]),
          };
        })
        .filter(Boolean),
    [feePpmByChannelId, nodeChannels]
  );

  const channelRefDetails = useMemo(
    () =>
      Object.fromEntries(
        channelHints.map((hint) => [
          hint.channelRef,
          {
            label: hint.label,
            currentFeePpm: hint.currentFeePpm,
          },
        ])
      ),
    [channelHints]
  );

  const hasActiveSession =
    Boolean(activeSessionId) &&
    sessionStatus &&
    !['completed', 'failed', 'canceled'].includes(sessionStatus.state);

  useEffect(() => {
    if (!activeSessionId || !sessionStatus || ['completed', 'failed', 'canceled'].includes(sessionStatus.state)) {
      return undefined;
    }

    conditionalRecallDebugLog('polling session', {
      sessionId: activeSessionId,
      state: sessionStatus.state,
    });

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await getConditionalRecallSessionStatus(activeSessionId);
        if (cancelled) return;
        setSessionStatus(response.status);
        conditionalRecallDebugLog('status response', response.status);

        if (response.status.state === 'completed') {
          const resultResponse = await getConditionalRecallSessionResult(activeSessionId);
          if (!cancelled) {
            setSessionResult(resultResponse.result);
            conditionalRecallDebugLog('result response', {
              sessionId: activeSessionId,
              aggregateChannels: resultResponse.result?.aggregate?.channels?.length || 0,
              suggestionCount: resultResponse.result?.suggestions?.length || 0,
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          conditionalRecallDebugLog('poll failed', error instanceof Error ? { message: error.message, stack: error.stack } : error);
          setPageError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSessionId, sessionStatus]);

  const handleFormChange = (field, value) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleConfigTest = async () => {
    setIsTestingConfig(true);
    setConfigTest(null);
    setConfigTestError(null);
    setPageError(null);
    conditionalRecallDebugLog('config test start', {
      restHost: isMockMode ? (formState.restHost || MOCK_REST_HOST) : formState.restHost,
      allowSelfSigned: formState.allowSelfSigned,
      isMockMode,
    });
    try {
      const response = await postConditionalRecallConfigTest({
        restHost: isMockMode ? (formState.restHost || MOCK_REST_HOST) : formState.restHost,
        macaroonHex: isMockMode ? (formState.macaroonHex || MOCK_MACAROON) : formState.macaroonHex,
        allowSelfSigned: formState.allowSelfSigned,
      });
      setConfigTest(response);
      conditionalRecallDebugLog('config test success', response);
    } catch (error) {
      conditionalRecallDebugLog('config test failed', error instanceof Error ? { message: error.message, stack: error.stack } : error);
      setConfigTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsTestingConfig(false);
    }
  };

  const handleStart = async () => {
    setIsStarting(true);
    setPageError(null);
    setSessionResult(null);
    setConfigTestError(null);
    conditionalRecallDebugLog('session start requested', {
      restHost: isMockMode ? (formState.restHost || MOCK_REST_HOST) : formState.restHost,
      lookbackDays: Number(formState.lookbackDays),
      liveWindowSeconds: Number(formState.liveWindowSeconds),
      channelHintCount: channelHints.length,
      isMockMode,
      channelHints: channelHints.map((hint) => ({
        channelRef: hint.channelRef,
        currentFeePpm: hint.currentFeePpm,
        label: hint.label,
      })),
    });

    try {
      const response = await postConditionalRecallSessionStart({
        routerConfig: {
          restHost: isMockMode ? (formState.restHost || MOCK_REST_HOST) : formState.restHost,
          macaroonHex: isMockMode ? (formState.macaroonHex || MOCK_MACAROON) : formState.macaroonHex,
          allowSelfSigned: formState.allowSelfSigned,
        },
        lookbackDays: Number(formState.lookbackDays),
        liveWindowSeconds: Number(formState.liveWindowSeconds),
        channelHints: channelHints.map((hint) => ({
          channelId: hint.channelId,
          channelRef: hint.channelRef,
          currentFeePpm: hint.currentFeePpm,
        })),
      });

      setActiveSessionId(response.sessionId);
      setSessionStatus(response.status);
      conditionalRecallDebugLog('session start response', response);
    } catch (error) {
      conditionalRecallDebugLog('session start failed', error instanceof Error ? { message: error.message, stack: error.stack } : error);
      setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeSessionId) return;
    conditionalRecallDebugLog('cancel requested', { sessionId: activeSessionId });
    try {
      const response = await postConditionalRecallSessionCancel(activeSessionId);
      setSessionStatus(response.status);
      conditionalRecallDebugLog('cancel response', response.status);
    } catch (error) {
      conditionalRecallDebugLog('cancel failed', error instanceof Error ? { message: error.message, stack: error.stack } : error);
      setPageError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleReset = () => {
    conditionalRecallDebugLog('page reset', {
      hadSessionId: activeSessionId,
      hadResult: Boolean(sessionResult),
    });
    setConfigTest(null);
    setConfigTestError(null);
    setActiveSessionId(null);
    setSessionStatus(null);
    setSessionResult(null);
    setPageError(null);
    setFormState((current) => ({
      ...current,
      macaroonHex: '',
    }));
  };

  const canStart =
    readText(isMockMode ? (formState.restHost || MOCK_REST_HOST) : formState.restHost).length > 0 &&
    readText(isMockMode ? (formState.macaroonHex || MOCK_MACAROON) : formState.macaroonHex).length > 0 &&
    channelHints.length > 0 &&
    !hasActiveSession;

  return (
    <div className="space-y-6 px-6 py-8">
      <SectionCard
        title="Conditional Recall"
        subtitle="Bounded HTLC traffic analysis with local collection, aggregate-only output, and immediate state wipe after completion or cancel."
        right={<StatusPill state={sessionStatus?.state || 'idle'} />}
      >
        {isMockMode ? (
          <div className="mb-5 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--batch-bg)', color: 'var(--text-primary)', border: '1px solid var(--batch-border)' }}>
            Mock mode is active. The local API uses deterministic forwarding history and HTLC stream data derived from the mock snapshot. No LNC or live LND REST endpoint is required for this page.
          </div>
        ) : null}
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <ExplainerTile
            title="What This Does"
            body="This page runs a short lived traffic analysis session. It loads a forwarding history baseline, watches live HTLC forwarding activity for a bounded window, and reduces that stream into per channel traffic pressure."
          />
          <ExplainerTile
            title="What You Get"
            body="The output is a draft fee review. Each channel gets aggregate counts, friction metrics, and if the thresholds are met, a suggested fee raise or fee decrease for manual review."
          />
          <ExplainerTile
            title="What Gets Forgotten"
            body="Raw event context is held only during the live session. The final result keeps channel level aggregates and suggestions only. It does not keep raw HTLC paths, hashes, or per event routing detail."
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>REST host</span>
              <input
                value={formState.restHost}
                onChange={(event) => handleFormChange('restHost', event.target.value)}
                placeholder={isMockMode ? MOCK_REST_HOST : 'localhost:8080'}
                className="rounded-xl border px-4 py-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Live window seconds</span>
              <input
                type="number"
                min="5"
                max="3600"
                value={formState.liveWindowSeconds}
                onChange={(event) => handleFormChange('liveWindowSeconds', event.target.value)}
                className="rounded-xl border px-4 py-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </label>

            <label className="flex flex-col gap-2 md:col-span-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Macaroon hex</span>
              <textarea
                value={formState.macaroonHex}
                onChange={(event) => handleFormChange('macaroonHex', event.target.value)}
                placeholder={isMockMode ? MOCK_MACAROON : 'Paste local read macaroon hex'}
                rows={5}
                className="rounded-xl border px-4 py-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {isMockMode
                  ? 'Mock mode uses an in-memory placeholder only. This field still stays in memory and is not persisted.'
                  : 'ForwardingHistory and SubscribeHtlcEvents both need local read access. This field stays in memory only.'}
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Lookback days</span>
              <input
                type="number"
                min="1"
                max="30"
                value={formState.lookbackDays}
                onChange={(event) => handleFormChange('lookbackDays', event.target.value)}
                className="rounded-xl border px-4 py-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </label>

            <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
              style={{
                backgroundColor: 'var(--bg-card-2)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
              }}
            >
              <input
                type="checkbox"
                checked={formState.allowSelfSigned}
                onChange={(event) => handleFormChange('allowSelfSigned', event.target.checked)}
              />
              Allow self signed TLS
            </label>
          </div>

          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>
                  Session Inputs
                </p>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  The page derives private channel references from the current browser node session and never sends raw channel ids back in the final result.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <p style={{ color: 'var(--text-secondary)' }}>Channel hints</p>
                  <p className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtNum(channelHints.length)}</p>
                </div>
                <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <p style={{ color: 'var(--text-secondary)' }}>Fee hints ready</p>
                  <p className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {feePpmLoading ? '…' : fmtNum(Object.values(feePpmByChannelId).filter((value) => value !== null && value !== undefined).length)}
                  </p>
                </div>
              </div>
              <div className="space-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {channelHints.slice(0, 5).map((hint) => (
                  <div key={hint.channelRef} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--bg-card)' }}>
                    <span>{hint.channelRef}</span>
                    <span>{hint.label}</span>
                  </div>
                ))}
                {channelHints.length > 5 ? (
                  <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--bg-card)' }}>
                    {channelHints.length - 5} more channels available in this session
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={handleConfigTest}
            disabled={isTestingConfig || hasActiveSession}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              backgroundColor: 'var(--bg-card-2)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              opacity: isTestingConfig || hasActiveSession ? 0.6 : 1,
            }}
          >
            {isTestingConfig ? 'Testing…' : 'Test Config'}
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart || isStarting}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              opacity: !canStart || isStarting ? 0.6 : 1,
            }}
          >
            {isStarting ? 'Starting…' : 'Start Session'}
          </button>
          <button
            onClick={handleCancel}
            disabled={!hasActiveSession}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              backgroundColor: 'var(--bg-card-2)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              opacity: hasActiveSession ? 1 : 0.5,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            Clear
          </button>
        </div>

        {configTest ? (
          <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>
            Forwarding history and HTLC stream checks succeeded for {configTest.restHost}.
          </div>
        ) : null}
        {configTestError ? (
          <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)' }}>
            {configTestError}
          </div>
        ) : null}
        {pageError ? (
          <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)' }}>
            {pageError}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Session Status"
        subtitle="Bounded session lifecycle. Raw event context is held in memory during collection only."
      >
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Session</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {activeSessionId ? `${activeSessionId.slice(0, 8)}…` : 'Not started'}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>History events</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmtNum(sessionStatus?.progress?.historyEventsProcessed || 0)}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Live events</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmtNum(sessionStatus?.progress?.liveEventsProcessed || 0)}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Tracked channels</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmtNum(sessionStatus?.progress?.channelsTracked || 0)}
            </p>
          </div>
        </div>
        {sessionStatus ? (
          <div className="mt-4 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p style={{ color: 'var(--text-secondary)' }}>Started</p>
                <p className="mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{sessionStatus.startedAt}</p>
              </div>
              <div>
                <p style={{ color: 'var(--text-secondary)' }}>Ends</p>
                <p className="mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{sessionStatus.endsAt || 'Pending'}</p>
              </div>
            </div>
            {sessionStatus.error ? (
              <div className="mt-4 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)' }}>
                {sessionStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Draft Fee Suggestions"
        subtitle="Deterministic local rules only for this first slice."
      >
        {!sessionResult ? (
          <div className="rounded-xl border px-4 py-6 text-sm" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)', color: 'var(--text-secondary)' }}>
            Start a Conditional Recall session to collect a forwarding baseline, watch the HTLC stream, and emit aggregate fee suggestions.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <ExplainerTile
                title="How Suggestions Are Made"
                body="High attempts with repeated forward or link failures increase friction. Higher failed amount and lower success rate increase confidence. Low activity with a relatively high current fee can trigger a fee decrease."
              />
              <ExplainerTile
                title="How To Read Friction"
                body="Friction is a simple 0 to 100 pressure score. Higher values mean the channel saw more failed forwarding relative to successful settlement and observed volume during the session window."
              />
              <ExplainerTile
                title="How To Use This"
                body="Treat the output as a review queue, not an automatic action. Look at the suggested channels first, compare them with your current routing posture, then decide whether to update fees manually."
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
                <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Suggestions</p>
                <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {fmtNum(sessionResult.suggestions.length)}
                </p>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
                <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Aggregate channels</p>
                <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {fmtNum(sessionResult.aggregate.channels.length)}
                </p>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}>
                <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>Collection window</p>
                <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {sessionResult.collectionSummary.windowStart || '—'}<br />{sessionResult.collectionSummary.windowEnd || '—'}
                </p>
              </div>
            </div>

            <div
              className="rounded-xl border p-4 text-sm"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card-2)' }}
            >
              <div className="grid gap-3 lg:grid-cols-4">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Attempts</p>
                  <p style={{ color: 'var(--text-secondary)' }}>Forward attempts seen in the baseline plus live session.</p>
                </div>
                <div>
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Settles</p>
                  <p style={{ color: 'var(--text-secondary)' }}>Forward events that completed successfully for that channel.</p>
                </div>
                <div>
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Failures</p>
                  <p style={{ color: 'var(--text-secondary)' }}>Forward fail and link fail counts observed during the live collection window.</p>
                </div>
                <div>
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Volume Pressure</p>
                  <p style={{ color: 'var(--text-secondary)' }}>Share of observed volume that ended up in failed HTLC flow during the session.</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
              <table className="min-w-full text-sm">
                <thead style={{ backgroundColor: 'var(--bg-card-2)', color: 'var(--text-secondary)' }}>
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Channel</th>
                    <th className="px-4 py-3 text-left font-semibold">Action</th>
                    <th className="px-4 py-3 text-left font-semibold">Current</th>
                    <th className="px-4 py-3 text-left font-semibold">Suggested</th>
                    <th className="px-4 py-3 text-left font-semibold">Friction</th>
                    <th className="px-4 py-3 text-left font-semibold">Confidence</th>
                    <th className="px-4 py-3 text-left font-semibold">Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionResult.suggestions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6" style={{ color: 'var(--text-secondary)' }}>
                        No draft fee adjustments met the v1 deterministic thresholds.
                      </td>
                    </tr>
                  ) : (
                    sessionResult.suggestions.map((suggestion) => {
                      const details = channelRefDetails[suggestion.channelRef];
                      return (
                        <tr key={suggestion.channelRef} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td className="px-4 py-3">
                            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{suggestion.channelRef}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{details?.label || 'Unknown peer'}</div>
                          </td>
                          <td className="px-4 py-3" style={{ color: suggestion.action === 'raise' ? 'var(--accent-3)' : 'var(--accent-1)' }}>
                            {suggestion.action}
                          </td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(suggestion.currentFeePpm || 0)} ppm</td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(suggestion.suggestedFeePpm)} ppm</td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(suggestion.frictionScore)}</td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{Math.round((suggestion.confidence || 0) * 100)}%</td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                            {suggestion.reasons.join(' · ')}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
              <table className="min-w-full text-sm">
                <thead style={{ backgroundColor: 'var(--bg-card-2)', color: 'var(--text-secondary)' }}>
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Channel</th>
                    <th className="px-4 py-3 text-left font-semibold">Attempts</th>
                    <th className="px-4 py-3 text-left font-semibold">Settles</th>
                    <th className="px-4 py-3 text-left font-semibold">Failures</th>
                    <th className="px-4 py-3 text-left font-semibold">Success Rate</th>
                    <th className="px-4 py-3 text-left font-semibold">Volume Pressure</th>
                    <th className="px-4 py-3 text-left font-semibold">Friction</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionResult.aggregate.channels.map((channel) => {
                    const details = channelRefDetails[channel.channelRef];
                    return (
                      <tr key={channel.channelRef} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td className="px-4 py-3">
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{channel.channelRef}</div>
                          <div style={{ color: 'var(--text-secondary)' }}>{details?.label || 'Unknown peer'}</div>
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(channel.attempts)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(channel.settles)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(channel.forwardFails + channel.linkFails)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtPct(channel.successRate)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtPct(channel.volumePressure)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{fmtNum(channel.frictionScore)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default ConditionalRecallPage;
