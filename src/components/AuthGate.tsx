import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { clientLogger } from '../logger';
import { INTERVALS_BASE } from '../config/api';
import { persistLogin, buildAuthorizationHeader, AuthCredentials } from '../lib/auth-storage';
import { initiateOAuthFlow, getOAuthRedirectUri } from '../lib/oauth';

/** Local UI state for the manual login form. */
interface ManualFormState {
  username: string;
  password: string;
}

interface AuthGateProps {
  onLogin: (credentials: AuthCredentials) => void;
}

async function validateWithIntervals(credentials: AuthCredentials): Promise<boolean> {
  try {
    clientLogger.info('Validating credentials with Intervals.icu', credentials.athleteId);
    const res = await fetch(
      `${INTERVALS_BASE}/api/v1/athlete/${credentials.athleteId}/profile`,
      { headers: { Authorization: buildAuthorizationHeader(credentials) } }
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
  const [form, setForm] = useState<ManualFormState>({
    username: (import.meta.env.DEV && import.meta.env.INTERVALS_ATHLETE_ID) || '',
    password: (import.meta.env.DEV && import.meta.env.INTERVALS_API_KEY) || '',
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualAuth = async () => {
    setLoading(true);
    setError(null);
    const credentials: AuthCredentials = {
      athleteId: form.username,
      accessToken: form.password,
      authType: 'basic',
    };
    const isValid = await validateWithIntervals(credentials);
    setLoading(false);
    if (isValid) {
      sessionStorage.setItem('silver_sprint_auth', JSON.stringify(credentials));
      if (rememberMe) {
        await persistLogin(credentials);
      }
      onLogin(credentials);
    } else {
      setError('Invalid credentials. Check your Username and Password.');
    }
  };

  const handleOAuthLogin = async () => {
    setOauthLoading(true);
    setError(null);
    try {
      await initiateOAuthFlow(getOAuthRedirectUri());
      // Browser will redirect — execution stops here.
    } catch (err) {
      clientLogger.error('Failed to initiate OAuth flow', '', err);
      setError('Could not start Intervals.icu login. Please try again.');
      setOauthLoading(false);
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

        {/* OAuth 2.0 login button */}
        <button
          onClick={handleOAuthLogin}
          disabled={oauthLoading || loading}
          className="icu-btn"
          style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 14, marginBottom: 20 }}
        >
          {oauthLoading ? 'Redirecting…' : 'Connect with Intervals.icu'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--icu-border)' }} />
          <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>or use API key</span>
          <div style={{ flex: 1, height: 1, background: 'var(--icu-border)' }} />
        </div>

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--icu-text-secondary)', display: 'block', marginBottom: 4 }}>
          Username
        </label>
        <input
          type="text"
          placeholder="e.g. i12345"
          className="icu-input"
          style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box' }}
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--icu-text-secondary)', display: 'block', marginBottom: 4 }}>
          Password
        </label>
        <input
          type="password"
          placeholder="Intervals.icu API key"
          className="icu-input"
          style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box' }}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--icu-text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            style={{ accentColor: 'var(--icu-primary)', width: 14, height: 14 }}
          />
          Remember me
        </label>

        <button
          onClick={handleManualAuth}
          disabled={loading || oauthLoading || !form.username || !form.password}
          className="icu-btn-ghost"
          style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 14 }}
        >
          {loading ? 'Connecting…' : 'Connect with API Key'}
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