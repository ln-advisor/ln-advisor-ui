import React from 'react';
import SectionBadge from './SectionBadge';

const DataSourceLegend = ({ publicSources = [], privateSources = [] }) => (
  <div className="grid gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--accent-1)' }}>Public</span>
      {publicSources.map((label) => (
        <SectionBadge key={label} label={label} variant="public" />
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--accent-2)' }}>Private</span>
      {privateSources.map((label) => (
        <SectionBadge key={label} label={label} variant="private" />
      ))}
    </div>
  </div>
);

export default DataSourceLegend;
