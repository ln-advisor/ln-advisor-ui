const CR_DEBUG_LOGS_FLAG = String(import.meta.env.VITE_ENABLE_CONDITIONAL_RECALL_DEBUG_LOGS || "")
  .trim()
  .toLowerCase();

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

declare global {
  interface Window {
    __LN_ADVISOR_CR_DEBUG__?: {
      enabled: boolean;
      entries: Array<{ label: string; payload?: unknown; timestamp: string }>;
      last?: { label: string; payload?: unknown; timestamp: string };
    };
  }
}

export const isConditionalRecallDebugLogsEnabled = () => isTruthy(CR_DEBUG_LOGS_FLAG);

const pushBrowserDebugEntry = (label, payload) => {
  if (typeof window === 'undefined') return;
  const state = window.__LN_ADVISOR_CR_DEBUG__ || {
    enabled: true,
    entries: [],
  };
  const entry = {
    label,
    payload,
    timestamp: new Date().toISOString(),
  };
  state.enabled = true;
  state.entries.push(entry);
  state.last = entry;
  window.__LN_ADVISOR_CR_DEBUG__ = state;
};

export const conditionalRecallDebugLog = (label, payload) => {
  if (!isConditionalRecallDebugLogsEnabled()) return;
  pushBrowserDebugEntry(label, payload);
  if (payload === undefined) {
    console.warn(`[LN Advisor][Conditional Recall] ${label}`);
    return;
  }
  console.warn(`[LN Advisor][Conditional Recall] ${label}`, payload);
};
