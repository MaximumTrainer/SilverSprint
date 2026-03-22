import React, { useEffect, useRef, useState } from 'react';
import { Zap, CheckCircle, AlertCircle } from 'lucide-react';
import { clientLogger } from '../logger';
import { handleOAuthCallback, getOAuthRedirectUri } from '../lib/oauth';
import { persistLogin, AuthCredentials } from '../lib/auth-storage';

interface OAuthCallbackPageProps {
  onLogin: (credentials: AuthCredentials) => void;
}

type CallbackState =
  | { status: 'loading' }
  | { status: 'success'; athleteId: string }
  | { status: 'error'; message: string };

/**
 * Dedicated page rendered at the `/callback` path after Intervals.icu
 * redirects back to the application.  Exchanges the authorization code for an
 * access token, persists the session, and navigates to the dashboard on
 * success.  Displays a descriptive error when the authorization fails or is
 * denied by the user.
 */
export const OAuthCallbackPage: React.FC<OAuthCallbackPageProps> = ({ onLogin }) => {
  const [state, setState] = useState<CallbackState>({ status: 'loading' });

  /** The app root URL (strips /callback and any query params). */
  const appRoot = new URL('./', window.location.href).toString();

  // Keep a stable ref to onLogin so the one-time effect always calls the
  // latest version without needing it in the dependency array.
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const oauthState = params.get('state');
      const error = params.get('error');
      const errorDescription = params.get('error_description');

      if (error) {
        clientLogger.warn(`OAuth authorization error: ${error}`, '');
        let description: string;
        if (errorDescription) {
          try {
            description = decodeURIComponent(errorDescription.replace(/\+/g, ' '));
          } catch {
            // Fall back to a safe, non-throwing representation if decoding fails.
            description = errorDescription.replace(/\+/g, ' ');
          }
        } else {
          description = `Authorization failed: ${error}`;
        }
        setState({ status: 'error', message: description });
        return;
      }

      if (!code) {
        setState({ status: 'error', message: 'No authorization code received from Intervals.icu.' });
        return;
      }

      try {
        clientLogger.info('Handling OAuth callback', '');
        const credentials = await handleOAuthCallback(code, oauthState, getOAuthRedirectUri());

        await persistLogin(credentials);
        sessionStorage.setItem('silver_sprint_auth', JSON.stringify(credentials));

        setState({ status: 'success', athleteId: credentials.athleteId });
        onLoginRef.current(credentials);

        // Navigate to the app root after a brief confirmation delay.
        setTimeout(() => {
          window.location.replace(new URL('./', window.location.href).toString());
        }, 1500);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error during sign-in.';
        clientLogger.error('OAuth callback handling failed', '', err);
        setState({ status: 'error', message });
      }
    };

    handleCallback();
  }, []);

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
      <div className="icu-card" style={{ width: '100%', maxWidth: 400, padding: 32, textAlign: 'center' }}>
        {state.status === 'loading' && (
          <>
            <Zap
              className="animate-pulse"
              size={40}
              style={{ color: 'var(--icu-primary)', marginBottom: 16 }}
            />
            <p style={{ color: 'var(--icu-text)', fontWeight: 600, marginBottom: 8 }}>
              Completing sign-in…
            </p>
            <p style={{ color: 'var(--icu-text-secondary)', fontSize: 13 }}>
              Exchanging authorization code with Intervals.icu
            </p>
          </>
        )}

        {state.status === 'success' && (
          <>
            <CheckCircle
              size={40}
              style={{ color: 'var(--icu-green)', marginBottom: 16 }}
            />
            <p style={{ color: 'var(--icu-text)', fontWeight: 600, marginBottom: 8 }}>
              Sign-in successful!
            </p>
            <p style={{ color: 'var(--icu-text-secondary)', fontSize: 13 }}>
              Connected as {state.athleteId}. Redirecting to your dashboard…
            </p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <AlertCircle
              size={40}
              style={{ color: 'var(--icu-red)', marginBottom: 16 }}
            />
            <p style={{ color: 'var(--icu-text)', fontWeight: 600, marginBottom: 8 }}>
              Sign-in failed
            </p>
            <p
              style={{
                color: 'var(--icu-text-secondary)',
                fontSize: 13,
                marginBottom: 20,
                wordBreak: 'break-word',
              }}
            >
              {state.message}
            </p>
            <a
              href={appRoot}
              className="icu-btn"
              style={{ display: 'inline-block', padding: '10px 24px', fontSize: 14 }}
            >
              Try again
            </a>
          </>
        )}
      </div>
    </div>
  );
};
