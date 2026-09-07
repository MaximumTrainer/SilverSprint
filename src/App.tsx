import React, { useState, useEffect, useCallback } from 'react';
import { OAuthCallbackPage } from './components/OAuthCallbackPage';
import { Dashboard, AthleteData } from './components/Dashboard';
import { PaceCurveScreen } from './components/PaceCurveScreen';
import { useIntervalsData } from './hooks/useIntervalsData';
import { usePaceCurve } from './hooks/usePaceCurve';
import { useRaceResults } from './hooks/useRaceResults';
import { clearRaceResults, clearAllRaceResults } from './lib/race-results-storage';
import { usePaceCurveDistances } from './hooks/usePaceCurveDistances';
import { clearPaceCurveDistances, clearAllPaceCurveDistances } from './lib/pace-curve-storage';
import { clearStreamCache, clearAllStreamCaches } from './lib/stream-cache';
import { AppRoute, rememberReturnRoute, resolveRoute, routeUrl } from './lib/routing';
import { NEUTRAL_CALIBRATION } from './domain/sprint/race-results';
import { SprintWorkout } from './domain/sprint/workouts';
import { clientLogger } from './logger';
import { AlertCircle, Zap } from 'lucide-react';
import { INTERVALS_BASE } from './config/api';
import { AuthCredentials, buildAuthorizationHeader, loadPersistedLogin, clearAuthCookie } from './lib/auth-storage';
import { initiateOAuthFlow, getOAuthRedirectUri } from './lib/oauth';
import {
  mockAthleteData,
  mockDailyTimeSeries,
  mockRaceEstimates,
  mockRecoveredEstimates,
  mockSprintRacePlans,
  mockTrainingPlan,
  mockDailyPlan,
  mockPaceCurveStreams,
  mockPaceCurveDistances,
  mockBestVmax60d,
} from './data/mockDashboardData';

const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthCredentials | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Which screen the URL asks for. Resolved relative to the deployment base by
  // `lib/routing`, so a deep link works from `/` on Vercel and from
  // `/SilverSprint/` on GitHub Pages alike. By the time this runs, the inline
  // script in index.html has already restored the path that `public/404.html`
  // stashed, so a direct link to /pace-curve resolves to the real path.
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute(window.location.href));
  const isOAuthCallbackPath = route === 'callback';

  // Back and forward must move between the screens, not out of the app.
  useEffect(() => {
    const onPopState = () => setRoute(resolveRoute(window.location.href));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /** Move to another screen without reloading — the sync must not re-run. */
  const navigate = useCallback((next: AppRoute) => {
    window.history.pushState(null, '', routeUrl(next, window.location.href));
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  // 1. Check for existing session on mount (dev env vars take priority)
  useEffect(() => {
    // OAuth callback path is handled entirely by OAuthCallbackPage.
    if (isOAuthCallbackPath) {
      setIsInitializing(false);
      return;
    }

    const initAuth = async () => {
      const devAthleteId = import.meta.env.INTERVALS_ATHLETE_ID;
      const devApiKey = import.meta.env.INTERVALS_API_KEY;

      if (import.meta.env.DEV && devAthleteId && devApiKey) {
        setAuth({ athleteId: devAthleteId, accessToken: devApiKey, authType: 'basic' });
      } else {
        // 1a. Current-tab sessionStorage takes priority
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
        // 1b. Fall back to the persistent encrypted cookie (cross-session)
        const persisted = await loadPersistedLogin();
        if (persisted) {
          sessionStorage.setItem('silver_sprint_auth', JSON.stringify(persisted));
          setAuth(persisted);
        }
      }
      setIsInitializing(false);
    };

    initAuth();
  }, [isOAuthCallbackPath]);

  // 2a. Known race times — persisted locally per athlete, cleared on logout.
  const {
    results: raceResults,
    addResult: addRaceResult,
    removeResult: removeRaceResult,
  } = useRaceResults(auth?.athleteId || '');

  // 2a-ii. Charted pace-curve distances — same lifecycle as the race times.
  const {
    distances: paceCurveDistances,
    addDistance: addPaceCurveDistance,
    toggleDistance: togglePaceCurveDistance,
  } = usePaceCurveDistances(auth?.athleteId || '');

  // 2b. Fetch data using our custom hook
  const {
    nfi, nfiStatus, avgVmax, todayVmax,
    recoveryHours, tsb, srs, staleVmax, age, bodyWeightKg, dailyTimeSeries, raceEstimates, recoveredEstimates, sprintRacePlans, trainingPlan, raceCalibration, dailyPlan, paceCurveCandidates, paceCurveEligible, raceEstimatorInput, loading, error,
  } = useIntervalsData(auth?.athleteId || '', auth?.accessToken || '', auth?.authType || 'basic', raceResults);

  // 2c. The pace curve's streams — the one fetch this app defers.
  //
  // Nothing is requested until the athlete opens the pace curve screen, which
  // is what takes a dashboard load from 54 `/streams` requests to none. The
  // state lives here rather than in the screen so that moving back to the
  // dashboard and returning does not re-fetch.
  const paceCurve = usePaceCurve(
    auth?.athleteId || '',
    auth?.accessToken || '',
    auth?.authType || 'basic',
    paceCurveCandidates,
    paceCurveEligible,
    raceEstimatorInput.bestVmax60d,
    route === 'pace-curve',
  );

  const handleOAuthLogin = async () => {
    try {
      // Signing in leaves the app entirely, so the screen the athlete asked
      // for has to survive outside the URL — otherwise a deep link to the pace
      // curve while signed out always lands on the dashboard.
      rememberReturnRoute(route);
      await initiateOAuthFlow(getOAuthRedirectUri());
      // Browser will redirect — execution stops here.
    } catch (err) {
      clientLogger.error('Failed to initiate OAuth flow', '', err);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('silver_sprint_auth');
    clearAuthCookie();
    // Known race times live as long as the login does — logging out is the
    // only thing that discards them.
    if (auth?.athleteId) {
      clearRaceResults(auth.athleteId);
      clearPaceCurveDistances(auth.athleteId);
      clearStreamCache(auth.athleteId);
    } else {
      clearAllRaceResults();
      clearAllPaceCurveDistances();
      clearAllStreamCaches();
    }
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

  // 3. Render the OAuth callback page when on the dedicated /callback path
  if (isOAuthCallbackPath) {
    return <OAuthCallbackPage onLogin={(creds) => setAuth(creds)} />;
  }

  // 4. Render the demo experience with mock data when not authenticated.
  //
  // The pace curve screen is reachable here too: a deep link to /pace-curve
  // while signed out shows the simulated curve read-only, and signing in from
  // it comes back to this screen rather than to the dashboard.
  if (!auth) {
    if (route === 'pace-curve') {
      return (
        <PaceCurveScreen
          streams={mockPaceCurveStreams}
          distances={mockPaceCurveDistances}
          bestVmax60d={mockBestVmax60d}
          status="ready"
          onBack={() => navigate('dashboard')}
          onLogin={handleOAuthLogin}
        />
      );
    }
    return (
      <Dashboard
        athleteData={mockAthleteData}
        dailyTimeSeries={mockDailyTimeSeries}
        raceEstimates={mockRaceEstimates}
        recoveredEstimates={mockRecoveredEstimates}
        sprintRacePlans={mockSprintRacePlans}
        trainingPlan={mockTrainingPlan}
        raceResults={[]}
        raceCalibration={NEUTRAL_CALIBRATION}
        dailyPlan={mockDailyPlan}
        onOpenPaceCurve={() => navigate('pace-curve')}
        onLogin={handleOAuthLogin}
        onLogout={() => {}}
        onPushWorkout={async () => false}
        onPushSession={async () => false}
      />
    );
  }

  // 5. Render Loading State
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

  if (route === 'pace-curve') {
    return (
      <PaceCurveScreen
        streams={paceCurve.streams}
        distances={paceCurveDistances}
        bestVmax60d={raceEstimatorInput.bestVmax60d}
        coverage={paceCurve.coverage}
        status={paceCurve.status === 'idle' ? 'loading' : paceCurve.status}
        errorMessage={paceCurve.errorMessage}
        rateLimited={paceCurve.rateLimited}
        onRetry={paceCurve.retry}
        onBack={() => navigate('dashboard')}
        onToggleDistance={togglePaceCurveDistance}
        onAddDistance={addPaceCurveDistance}
      />
    );
  }

  return (
    <Dashboard
      athleteData={athleteData}
      dailyTimeSeries={dailyTimeSeries}
      raceEstimates={raceEstimates}
      recoveredEstimates={recoveredEstimates}
      sprintRacePlans={sprintRacePlans}
      trainingPlan={trainingPlan}
      raceResults={raceResults}
      raceCalibration={raceCalibration}
      dailyPlan={dailyPlan}
      onOpenPaceCurve={() => navigate('pace-curve')}
      onAddRaceResult={addRaceResult}
      onRemoveRaceResult={removeRaceResult}
      onLogout={handleLogout}
      onPushWorkout={handlePushWorkout}
      onPushSession={handlePushSession}
    />
  );
};

export default App;