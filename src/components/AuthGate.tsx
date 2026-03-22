import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { clientLogger } from '../logger';
import { AuthCredentials } from '../lib/auth-storage';
import { initiateOAuthFlow, getOAuthRedirectUri } from '../lib/oauth';

interface AuthGateProps {
  onLogin: (credentials: AuthCredentials) => void;
}

export const AuthGate: React.FC<AuthGateProps> = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOAuthLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await initiateOAuthFlow(getOAuthRedirectUri());
      // Browser will redirect — execution stops here.
    } catch (err) {
      clientLogger.error('Failed to initiate OAuth flow', '', err);
      setError('Could not start Intervals.icu login. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--icu-bg)',
        padding: 16,
      }}
    >
      <div className="icu-card" style={{ width: '100%', maxWidth: 400, padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Zap size={28} style={{ color: 'var(--icu-primary)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--icu-text)' }}>SilverSprint</div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 1 }}>
              Connect with your Intervals.icu account
            </div>
          </div>
        </div>

        <button
          onClick={handleOAuthLogin}
          disabled={loading}
          className="icu-btn"
          style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 14 }}
        >
          {loading ? 'Redirecting…' : 'Connect with Intervals.icu'}
        </button>

        {error && (
          <p style={{ color: 'var(--icu-red)', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
