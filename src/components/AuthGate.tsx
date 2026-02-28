import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { clientLogger } from '../logger';

interface AuthCredentials {
  athleteId: string;
  apiKey: string;
}

interface AuthGateProps {
  onLogin: (credentials: AuthCredentials) => void;
}

async function validateWithIntervals(credentials: AuthCredentials): Promise<boolean> {
  try {
    clientLogger.info('Validating credentials with Intervals.icu', credentials.athleteId);
    const authHeader = btoa(`API_KEY:${credentials.apiKey}`);
    const res = await fetch(
      `/intervals/api/v1/athlete/${credentials.athleteId}/profile`,
      { headers: { Authorization: `Basic ${authHeader}` } }
    );
    if (res.ok) {
      clientLogger.info('Authentication successful', credentials.athleteId);
    } else {
      clientLogger.warn(`Authentication failed — HTTP ${res.status}`, credentials.athleteId);
    }
    return res.ok;
  } catch (err) {
    clientLogger.error('Authentication request failed', credentials.athleteId, err);
    return false;
  }
}

export const AuthGate: React.FC<AuthGateProps> = ({ onLogin }) => {
  const [credentials, setCredentials] = useState<AuthCredentials>({
    athleteId: (import.meta.env.DEV && import.meta.env.INTERVALS_ATHLETE_ID) || '',
    apiKey: (import.meta.env.DEV && import.meta.env.INTERVALS_API_KEY) || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async () => {
    setLoading(true);
    setError(null);
    const isValid = await validateWithIntervals(credentials);
    setLoading(false);
    if (isValid) {
      sessionStorage.setItem('silver_sprint_auth', JSON.stringify(credentials));
      onLogin(credentials);
    } else {
      setError('Invalid credentials. Check your Athlete ID and API Key.');
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

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--icu-text-secondary)', display: 'block', marginBottom: 4 }}>
          Athlete ID
        </label>
        <input
          type="text"
          placeholder="e.g. i12345"
          className="icu-input"
          style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box' }}
          value={credentials.athleteId}
          onChange={(e) => setCredentials({ ...credentials, athleteId: e.target.value })}
        />

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--icu-text-secondary)', display: 'block', marginBottom: 4 }}>
          API Key
        </label>
        <input
          type="password"
          placeholder="Intervals.icu API key"
          className="icu-input"
          style={{ width: '100%', marginBottom: 20, boxSizing: 'border-box' }}
          value={credentials.apiKey}
          onChange={(e) => setCredentials({ ...credentials, apiKey: e.target.value })}
        />

        <button
          onClick={handleAuth}
          disabled={loading || !credentials.athleteId || !credentials.apiKey}
          className="icu-btn"
          style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 14 }}
        >
          {loading ? 'Connecting…' : 'Connect'}
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