import React, { useState } from 'react';
import { X, Zap } from 'lucide-react';

interface DemoBannerProps {
  onLogin: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onLogin }) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      style={{
        background: 'var(--icu-amber, #d97706)',
        color: '#fff',
        fontSize: 12,
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        position: 'relative',
      }}
    >
      <Zap size={13} style={{ flexShrink: 0, opacity: 0.9 }} />
      <span style={{ opacity: 0.95 }}>
        You're viewing demo data.{' '}
        <button
          onClick={onLogin}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
            padding: 0,
            fontSize: 'inherit',
            textDecoration: 'underline',
          }}
        >
          Connect your Intervals.icu account
        </button>
        {' '}to see your real sprint metrics.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          right: 12,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#fff',
          opacity: 0.7,
          padding: 2,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
};
