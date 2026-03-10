import React from 'react';

const InlineSpinner = ({ label }) => (
  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
    <span className="inline-block h-3 w-3 rounded-full border-2 border-transparent border-t-current animate-spin" aria-hidden="true" />
    {label}
  </div>
);

export default InlineSpinner;
