import React, { useState, useEffect } from 'react';
import { AuthGate } from './components/AuthGate';
import { Dashboard, AthleteData } from './components/Dashboard';
import { useIntervalsData } from './hooks/useIntervalsData';
import { SprintWorkout } from './domain/sprint/workouts';
import { clientLogger } from './logger';
import { AlertCircle, Zap } from 'lucide-react';
import { INTERVALS_BASE } from './config/api';
import { AuthCredentials, buildAuthorizationHeader, loadPersistedLogin, clearAuthCookie, persistLogin } from './lib/auth-storage';
import { handleOAuthCallback, getOAuthRedirectUri } from './lib/oauth';

const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthCredentials | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // 1. Check for existing session on mount (dev env vars take priority)
  useEffect(() => {
    const initAuth = async () => {
      const devAthleteId = import.meta.env.INTERVALS_ATHLETE_ID;
      const devApiKey = import.meta.env.INTERVALS_API_KEY;

      if (import.meta.env.DEV && devAthleteId && devApiKey) {
        setAuth({ athleteId: devAthleteId, accessToken: devApiKey, authType: 'basic' });
      } else {
        // 1a. Handle OAuth 2.0 callback: check for ?code= or ?error= in the URL
        const params = new URLSearchParams(window.location.search);
        const oauthCode = params.get('code');
        const oauthState = params.get('state');
        const oauthError = params.get('error');

        if (oauthError) {
          // Authorization server reported an error (e.g. access_denied).
          // Log only the stable error code, not the server-provided description which
          // could contain untrusted content from the redirect URL.
          clientLogger.warn(`OAuth authorization error: ${oauthError}`, '');
          window.history.replaceState({}, document.title, window.location.pathname);
          // Fall through to the normal login/session flow.
        } else if (oauthCode) {
          try {
            clientLogger.info('Handling OAuth callback', '');
            const credentials = await handleOAuthCallback(oauthCode, oauthState, getOAuthRedirectUri());
            // Remove the ?code= and ?state= from the URL without triggering a page reload
            window.history.replaceState({}, document.title, window.location.pathname);
            // Persist credentials in the encrypted cookie so the session survives a reload.
            await persistLogin(credentials);
            sessionStorage.setItem('silver_sprint_auth', JSON.stringify(credentials));
            setAuth(credentials);
            setIsInitializing(false);
            return;
          } catch (err) {
            clientLogger.error('OAuth callback handling failed', '', err);
            // Fall through to normal login flow
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }

        // 1b. Current-tab sessionStorage takes priority
        const savedAuth = sessionStorage.getItem('silver_sprint_auth');
        if (savedAuth) {
          try {
            const parsed = JSON.parse(savedAuth);
            if (
              parsed &&
              typeof parsed.athleteId === 'string' &&
              typeof parsed.accessToken === 'string'
            ) {
              setAuth({
                athleteId: parsed.athleteId,
                accessToken: parsed.accessToken,
                authType: parsed.authType === 'bearer' ? 'bearer' : 'basic',
              });
              setIsInitializing(false);
              return;
            } else {
              sessionStorage.removeItem('silver_sprint_auth');
            }
          } catch {
            sessionStorage.removeItem('silver_sprint_auth');
          }
        }
        // 1c. Fall back to the persistent encrypted cookie (cross-session)
        const persisted = await loadPersistedLogin();
        if (persisted) {
          sessionStorage.setItem('silver_sprint_auth', JSON.stringify(persisted));
          setAuth(persisted);
        }
      }
      setIsInitializing(false);
    };

    initAuth();
  }, []);

  // 2. Fetch data using our custom hook
  const {
    intervals, wellness, nfi, nfiStatus, avgVmax, todayVmax,
    recoveryHours, tsb, strengthZone, srs, staleVmax, age, bodyWeightKg, dailyTimeSeries, raceEstimates, recoveredEstimates, sprintRacePlans, loading, error,
  } = useIntervalsData(auth?.athleteId || '', auth?.accessToken || '', auth?.authType || 'basic');

  const handleLogout = () => {
    sessionStorage.removeItem('silver_sprint_auth');
    clearAuthCookie();
    // In dev mode, re-apply .env credentials instead of dropping to an empty auth gate
    const devAthleteId = import.meta.env.INTERVALS_ATHLETE_ID;
    const devApiKey = import.meta.env.INTERVALS_API_KEY;
    if (import.meta.env.DEV && devAthleteId && devApiKey) {
      setAuth({ athleteId: devAthleteId, accessToken: devApiKey, authType: 'basic' });
    } else {
      setAuth(null);
    }
  };

  /** Push a sprint workout to the Intervals.icu calendar */
  const handlePushWorkout = async (workout: SprintWorkout, date: string): Promise<boolean> => {
    if (!auth) return false;
    try {
      clientLogger.info(`Pushing workout "${workout.name}" to ${date}`, auth.athleteId);
      const res = await fetch(
        `${INTERVALS_BASE}/api/v1/athlete/${auth.athleteId}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: buildAuthorizationHeader(auth),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: 'WORKOUT',
            start_date_local: `${date}T00:00:00`,
            type: 'Run',
            name: workout.name,
            description: workout.workoutDescription,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        clientLogger.error(`Push failed — HTTP ${res.status}: ${body}`, auth.athleteId);
      } else {
        clientLogger.info('Push workout success', auth.athleteId);
      }
      return res.ok;
    } catch (err) {
      clientLogger.error('Push workout failed', auth.athleteId, err);
      return false;
    }
  };

  /** Push a key session from a race plan to the Intervals.icu calendar */
  const handlePushSession = async (sessionName: string, raceName: string, date: string): Promise<boolean> => {
    if (!auth) return false;
    try {
      clientLogger.info(`Pushing session "${sessionName}" for ${raceName} to ${date}`, auth.athleteId);
      const res = await fetch(
        `${INTERVALS_BASE}/api/v1/athlete/${auth.athleteId}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: buildAuthorizationHeader(auth),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: 'WORKOUT',
            start_date_local: `${date}T00:00:00`,
            type: 'Run',
            name: `${raceName} Prep: ${sessionName}`,
            description: `Race prep session for ${raceName}\n\n${sessionName}`,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        clientLogger.error(`Push session failed — HTTP ${res.status}: ${body}`, auth.athleteId);
      } else {
        clientLogger.info('Push session success', auth.athleteId);
      }
      return res.ok;
    } catch (err) {
      clientLogger.error('Push session failed', auth.athleteId, err);
      return false;
    }
  };

  if (isInitializing) return null; // Prevent flicker

  // 3. Render Login if no auth
  if (!auth) {
    return <AuthGate onLogin={(creds) => setAuth(creds)} />;
  }

  // 4. Render Loading State
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--icu-bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--icu-text)',
        }}
      >
        <Zap className="animate-pulse" size={40} style={{ color: 'var(--icu-primary)', marginBottom: 12 }} />
        <p style={{ color: 'var(--icu-text-secondary)', fontSize: 14 }}>Syncing sprint data…</p>
      </div>
    );
  }

  // 5. Render Error State
  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--icu-bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: 'var(--icu-text)',
        }}
      >
        <AlertCircle size={40} style={{ color: 'var(--icu-red)', marginBottom: 12 }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Sync Error</h2>
        <p style={{ color: 'var(--icu-text-secondary)', marginBottom: 20, maxWidth: 400 }}>{error}</p>
        <button onClick={handleLogout} className="icu-btn-ghost">
          Reset Credentials
        </button>
      </div>
    );
  }

  // 6. Main Application View — values from hook, no hardcoding
  const athleteData: AthleteData = {
    name: auth.athleteId,
    age,
    nfi,
    nfiStatus,
    todayVmax,
    avgVmax,
    recoveryHours,
    srs,
    tsb,
    staleVmax,
    bodyWeightKg,
  };

  return (
    <Dashboard
      athleteData={athleteData}
      dailyTimeSeries={dailyTimeSeries}
      raceEstimates={raceEstimates}
      recoveredEstimates={recoveredEstimates}
      sprintRacePlans={sprintRacePlans}
      onLogout={handleLogout}
      onPushWorkout={handlePushWorkout}
      onPushSession={handlePushSession}
    />
  );
};

export default App;