const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

const isEnabled = (): boolean =>
  TRUTHY_VALUES.has(String(process.env.API_ENABLE_CONDITIONAL_RECALL_DEBUG_LOGS || "").trim().toLowerCase());

export const conditionalRecallServerDebugLog = (label: string, payload?: unknown): void => {
  if (!isEnabled()) return;
  if (payload === undefined) {
    console.warn(`[LN Advisor][Conditional Recall][API] ${label}`);
    return;
  }
  console.warn(`[LN Advisor][Conditional Recall][API] ${label}`, payload);
};
