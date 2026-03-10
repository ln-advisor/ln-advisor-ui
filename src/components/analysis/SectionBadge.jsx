import React from 'react';

const VARIANTS = {
  public: {
    background: 'rgba(14,165,164,0.14)',
    color: 'var(--accent-1)',
  },
  private: {
    background: 'rgba(37,99,235,0.16)',
    color: 'var(--accent-2)',
  },
  neutral: {
    background: 'var(--badge-bg)',
    color: 'var(--text-secondary)',
  },
};

const SectionBadge = ({ label, variant = 'neutral' }) => {
  const style = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={style}>
      {label}
    </span>
  );
};

export default SectionBadge;
