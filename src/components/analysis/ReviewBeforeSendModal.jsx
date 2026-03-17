import React from 'react';
import { createPortal } from 'react-dom';

const ReviewBeforeSendModal = ({
  isOpen,
  onClose,
  onConfirm,
  darkMode,
  title = 'Review Before Send',
  requestPlan = null,
  sending = false,
  error = null,
}) => {
  if (!isOpen || !requestPlan) return null;

  const requests = Array.isArray(requestPlan.requests) ? requestPlan.requests : [];
  const primaryRequest = requests.find((request) => request.method === 'POST' && request.body) || requests[0] || null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-6">
      <div
        className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-3xl border"
        onClick={(event) => event.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
        }}
      >
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Review the exact request before it is sent.
            </p>
          </div>
          <button onClick={onClose} disabled={sending} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6 space-y-6">
          {sending && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                borderColor: darkMode ? 'rgba(96,165,250,0.24)' : 'rgba(37,99,235,0.18)',
                backgroundColor: darkMode ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)',
                color: 'var(--text-primary)',
              }}
            >
              Sending request. The result will appear in the page when the verified run completes.
            </div>
          )}
          {error && !sending && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                borderColor: darkMode ? 'rgba(248,113,113,0.26)' : 'rgba(220,38,38,0.18)',
                backgroundColor: darkMode ? 'rgba(127,29,29,0.18)' : 'rgba(254,242,242,1)',
                color: darkMode ? '#fca5a5' : '#991b1b',
              }}
            >
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-secondary)' }}>Route</span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{requestPlan.route || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-secondary)' }}>Transport</span>
              <span className="font-mono text-xs text-right" style={{ color: 'var(--text-primary)' }}>{requestPlan.transport || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-secondary)' }}>Request Count</span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{requests.length}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-secondary)' }}>Primary Body Size</span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{primaryRequest?.bodyBytes ?? 0} bytes</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
              Planned Requests
            </div>
            <div className="space-y-2">
              {requests.map((request, index) => (
                <div
                  key={`${request.method}-${request.endpoint}-${index}`}
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{request.label || `Request ${index + 1}`}</div>
                      <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{request.endpoint}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{request.method}</div>
                      {typeof request.bodyBytes === 'number' && (
                        <div className="mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{request.bodyBytes} bytes</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
              Primary Request Body
            </div>
            <div
              className="max-h-[36vh] overflow-auto rounded-2xl border p-4 font-mono text-xs"
              style={{
                borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
                backgroundColor: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(15,23,42,0.03)',
                color: darkMode ? '#94a3b8' : '#334155',
              }}
            >
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(primaryRequest?.body || null, null, 2)}</pre>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-xl text-sm font-bold"
            style={{
              color: 'var(--text-secondary)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending || !primaryRequest}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))',
              opacity: sending ? 0.7 : 1,
            }}
          >
            {sending ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReviewBeforeSendModal;
