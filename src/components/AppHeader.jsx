import React from 'react';
import { UsersIcon } from '@heroicons/react/24/outline'; // Or any other icon you prefer

const AppHeader = ({ nodeInfo, nodeChannelsCount, peersCount, onShowPeers }) => { // Added onShowPeers prop
  const headerStatItemStyle = "cursor-pointer hover:opacity-75 transition-opacity duration-150 flex items-center gap-2";

  return (
    <header className="px-6 py-5 border-b transition-colors duration-300" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
        <div className="flex items-center gap-4">
          <div
            className="h-11 w-11 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--accent-1), var(--accent-2))' }}
          >
            <img src="/favicon.png" alt="Logo" className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display">LN Advisor</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Lightning node analysis and recommendations
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <div>
            Height: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nodeInfo?.blockHeight || '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Synced:</span>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{
                background: nodeInfo?.syncedToChain ? 'var(--success-bg)' : 'var(--error-bg)',
                color: nodeInfo?.syncedToChain ? 'var(--success-text)' : 'var(--error-text)',
              }}
            >
              {typeof nodeInfo?.syncedToChain === 'boolean' ? (nodeInfo.syncedToChain ? 'Healthy' : 'Lagging') : '...'}
            </span>
          </div>
          <div>
            Channels: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nodeChannelsCount ?? '...'}</span>
          </div>
          <div
            onClick={onShowPeers}
            className={headerStatItemStyle}
            role="button"
            tabIndex={0}
          >
            <UsersIcon className="h-4 w-4" style={{ color: 'var(--text-primary)'}} />
            Peers: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{peersCount ?? '...'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
