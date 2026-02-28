import React, { useState, useEffect } from 'react';
import { AuthGate } from './components/AuthGate';
import { Dashboard, AthleteData } from './components/Dashboard';
import { useIntervalsData } from './hooks/useIntervalsData';
import { SprintWorkout } from './logic/sprint-workouts';
import { clientLogger } from './logger';
import { AlertCircle, Zap } from 'lucide-react';

const App: React.FC = () => {
  const [auth, setAuth] = useState<{ athleteId: string; apiKey: string } | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // 1. Check for existing session on mount (dev env vars take priority)
  useEffect(() => {
    const devAthleteId = import.meta.env.INTERVALS_ATHLETE_ID;
    const devApiKey = import.meta.env.INTERVALS_API_KEY;

    if (import.meta.env.DEV && devAthleteId && devApiKey) {
      setAuth({ athleteId: devAthleteId, apiKey: devApiKey });
    } else {
      const savedAuth = sessionStorage.getItem('silver_sprint_auth');
      if (savedAuth) {
        try {
          const parsed = JSON.parse(savedAuth);
          if (parsed && typeof parsed.athleteId === 'string' && typeof parsed.apiKey === 'string') {
            setAuth(parsed);
          } else {
            sessionStorage.removeItem('silver_sprint_auth');
          }
        } catch {
          sessionStorage.removeItem('silver_sprint_auth');
        }
      }
    }
    setIsInitializing(false);
  }, []);

  // 2. Fetch data using our custom hook
  const {
    intervals, wellness, nfi, nfiStatus, avgVmax, todayVmax,
    recoveryHours, tsb, strengthZone, srs, age, bodyWeightKg, dailyTimeSeries, raceEstimates, recoveredEstimates, sprintRacePlans, loading, error,
  } = useIntervalsData(auth?.athleteId || '', auth?.apiKey || '');

  const handleLogout = () => {
    sessionStorage.removeItem('silver_sprint_auth');
    // In dev mode, re-apply .env credentials instead of dropping to an empty auth gate
    const devAthleteId = import.meta.env.INTERVALS_ATHLETE_ID;
    const devApiKey = import.meta.env.INTERVALS_API_KEY;
    if (import.meta.env.DEV && devAthleteId && devApiKey) {
      setAuth({ athleteId: devAthleteId, apiKey: devApiKey });
    } else {
      setAuth(null);
    }
  };

  /** Push a sprint workout to the Intervals.icu calendar */
  const handlePushWorkout = async (workout: SprintWorkout, date: string): Promise<boolean> => {
    if (!auth) return false;
    try {
      clientLogger.info(`Pushing workout "${workout.name}" to ${date}`, auth.athleteId);
      const authHeader = btoa(`API_KEY:${auth.apiKey}`);
      const res = await fetch(
        `/intervals/api/v1/athlete/${auth.athleteId}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: 'WORKOUT',
            start_date_local: date,
            name: workout.name,
            description: workout.workoutDescription,
            type: 'Run',
          }),
        },
      );
      clientLogger.info(`Push result: ${res.ok ? 'success' : `HTTP ${res.status}`}`, auth.athleteId);
      return res.ok;
    } catch (err) {
      clientLogger.error('Push workout failed', auth.athleteId, err);
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
    />
  );
};

export default App;