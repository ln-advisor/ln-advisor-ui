import React from 'react';

const ErrorBanner = ({ message }) => {
  if (!message) return null;
  return (
    <div
      className="rounded-xl p-4 text-sm"
      style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-text)' }}
    >
      {message}
    </div>
  );
};

export default ErrorBanner;
