import React, { useState, useMemo } from 'react';
import {
  Zap, Activity, Dumbbell, User, LogOut, Send, Clock, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, XCircle, Info, Timer, Flag,
} from 'lucide-react';
import { SilverSprintLogic, NFIStatus } from '../logic/logic';
import { StrengthPeriodization } from '../logic/periodization';
import { SprintWorkoutGenerator, SprintWorkout } from '../logic/sprint-workouts';
import { RaceEstimate } from '../logic/race-estimator';
import { SprintRacePlan, PriorRaceContext } from '../logic/race-plan';
import { TimeSeriesChart, DailyDataPoint } from './TimeSeriesChart';

export interface AthleteData {
  name: string;
  age: number;
  nfi: number;
  nfiStatus: NFIStatus;
  todayVmax: number;
  avgVmax: number;
  recoveryHours: number;
  srs: number;
  tsb: number;
  bodyWeightKg: number | null;
}

interface DashboardProps {
  athleteData: AthleteData;
  dailyTimeSeries: DailyDataPoint[];
  raceEstimates: RaceEstimate[];
  /** Predicted times at green neural readiness. Empty when already green. */
  recoveredEstimates: RaceEstimate[];
  sprintRacePlans: SprintRacePlan[];
  onLogout: () => void;
  onPushWorkout: (workout: SprintWorkout, date: string) => Promise<boolean>;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function getNFIColorClasses(status: NFIStatus) {
  switch (status) {
    case 'green':
      return { bg: 'bg-green-500/10', border: 'border-green-500', text: 'text-green-500' };
    case 'amber':
      return { bg: 'bg-amber-500/10', border: 'border-amber-500', text: 'text-amber-500' };
    case 'red':
      return { bg: 'bg-red-500/10', border: 'border-red-500', text: 'text-red-500' };
  }
}

function getNFIMessage(status: NFIStatus): string {
  switch (status) {
    case 'green':
      return 'CNS is primed for Max Velocity. Focus on block starts and flying 30s.';
    case 'amber':
      return 'CNS suppression detected. Limit volume; focus on technical drills.';
    case 'red':
      return 'Danger Zone — significant neural fatigue. Rest or active recovery only.';
  }
}

const StatusIcon: React.FC<{ status: NFIStatus; size?: number }> = ({ status, size = 18 }) => {
  switch (status) {
    case 'green':
      return <CheckCircle size={size} className="text-green-500" />;
    case 'amber':
      return <AlertTriangle size={size} className="text-amber-500" />;
    case 'red':
      return <XCircle size={size} className="text-red-500" />;
  }
};

function getStrengthZoneColor(zone: string): string {
  switch (zone) {
    case 'fresh': return 'var(--icu-green)';
    case 'tired': return 'var(--icu-orange)';
    case 'fatigued': return 'var(--icu-red)';
    default: return 'var(--icu-text-secondary)';
  }
}

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span className="icu-tooltip-wrapper" style={{ marginLeft: 4 }}>
    <Info size={12} style={{ color: 'var(--icu-text-disabled)' }} />
    <span className="icu-tooltip">{text}</span>
  </span>
);

/* ── Component ───────────────────────────────────────────────── */

export const Dashboard: React.FC<DashboardProps> = ({
  athleteData,
  dailyTimeSeries,
  raceEstimates,
  recoveredEstimates,
  sprintRacePlans,
  onLogout,
  onPushWorkout,
}) => {
  const { nfi, nfiStatus } = athleteData;
  const colors = getNFIColorClasses(nfiStatus);
  const prescription = useMemo(() => StrengthPeriodization.getPrescription(athleteData.tsb), [athleteData.tsb]);
  const sprintWorkout = useMemo(() => SprintWorkoutGenerator.generate(nfiStatus, nfi), [nfiStatus, nfi]);

  const [bodyWeight, setBodyWeight] = useState<string>(
    athleteData.bodyWeightKg != null ? String(athleteData.bodyWeightKg) : ''
  );
  const [bodyWeightAutoDetected, setBodyWeightAutoDetected] = useState(
    athleteData.bodyWeightKg != null
  );
  const [pushDate, setPushDate] = useState(getTomorrowDate());
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sprintExpanded, setSprintExpanded] = useState(false);

  // Sync body weight from Intervals.icu when athleteData updates
  React.useEffect(() => {
    if (athleteData.bodyWeightKg != null && athleteData.bodyWeightKg > 0) {
      setBodyWeight(String(athleteData.bodyWeightKg));
      setBodyWeightAutoDetected(true);
    }
  }, [athleteData.bodyWeightKg]);

  const bwKg = parseFloat(bodyWeight) || 0;

  const handlePush = async () => {
    setPushState('loading');
    try {
      const ok = await onPushWorkout(sprintWorkout, pushDate);
      setPushState(ok ? 'success' : 'error');
    } catch {
      setPushState('error');
    }
    setTimeout(() => setPushState('idle'), 4000);
  };

  const strengthZone = prescription.zone;
  const strengthZoneLabel = strengthZone === 'fresh' ? 'Max Strength' : strengthZone === 'tired' ? 'Plyometric' : 'Recovery';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--icu-bg)', color: 'var(--icu-text)' }}>

      {/* ── Top Bar ────────────────────────────────────────── */}
      <header
        style={{
          background: 'var(--icu-surface)',
          borderBottom: '1px solid var(--icu-border)',
          padding: '0 24px',
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Zap size={20} style={{ color: 'var(--icu-primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>
            SilverSprint
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--icu-text-disabled)',
              marginLeft: 4,
              fontWeight: 500,
            }}
          >
            Masters Sprint Intelligence
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--icu-text-secondary)',
            }}
          >
            <User size={14} />
            <span>{athleteData.name}</span>
          </div>
          <button
            onClick={onLogout}
            className="icu-btn-ghost"
            style={{ padding: '4px 8px', fontSize: 12 }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────── */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px' }}>

        {/* ── Summary Cards Row ────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {/* Neural Readiness */}
          <div className={`icu-stat ${colors.border}`} style={{ borderLeft: `3px solid` }}>
            <div className="icu-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusIcon status={nfiStatus} size={14} /> Neural Readiness
              <InfoTooltip text="Neural Fatigue Index (NFI) = today's Vmax ÷ 30-day avg Vmax. Green > 97%: CNS primed for max velocity. Amber 94–97%: limit volume, focus on technique. Red < 94%: significant fatigue — rest or active recovery only." />
            </div>
            <div className="icu-stat-value" style={{ color: nfiStatus === 'green' ? 'var(--icu-green)' : nfiStatus === 'amber' ? 'var(--icu-amber)' : 'var(--icu-red)' }}>
              {(nfi * 100).toFixed(1)}<span style={{ fontSize: 14, fontWeight: 400 }}>%</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 2 }}>
              Vmax {athleteData.todayVmax.toFixed(1)} / avg {athleteData.avgVmax.toFixed(1)} m/s
            </div>
          </div>

          {/* Strength Zone */}
          <div className="icu-stat" style={{ borderLeft: `3px solid ${getStrengthZoneColor(strengthZone)}` }}>
            <div className="icu-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dumbbell size={14} style={{ color: getStrengthZoneColor(strengthZone) }} /> Strength Zone
              <InfoTooltip text="Based on Training Stress Balance (TSB). Fresh (TSB ≥ 0): Max Strength — high intensity, low volume. Tired (TSB −10 to −20): Plyometrics — moderate intensity. Fatigued (TSB < −20): Rest or active mobility only." />
            </div>
            <div className="icu-stat-value" style={{ color: getStrengthZoneColor(strengthZone), textTransform: 'capitalize' }}>
              {strengthZone}
            </div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 2 }}>
              TSB {athleteData.tsb > 0 ? '+' : ''}{athleteData.tsb} · {strengthZoneLabel}
            </div>
          </div>

          {/* Recovery */}
          <div className="icu-stat" style={{ borderLeft: '3px solid var(--icu-primary)' }}>
            <div className="icu-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} style={{ color: 'var(--icu-primary)' }} /> Recovery Window
              <InfoTooltip text="Minimum hours between max-effort sessions. Driven by Sprint Recovery Score (SRS 0–100): composite of HRV ratio (45%), Training Stress Balance (30%), and Neural Fatigue Index (25%). Base: 48h + (Age−40)×6h. SRS penalty adds up to 48h — so range for age 45 is 78–126h." />
            </div>
            <div className="icu-stat-value" style={{ color: 'var(--icu-primary)' }}>
              {athleteData.recoveryHours}<span style={{ fontSize: 14, fontWeight: 400 }}>h</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 2 }}>
              Age {athleteData.age} · SRS {athleteData.srs}/100
            </div>
          </div>
        </div>

        {/* ── Readiness Banner ─────────────────────────────── */}
        <div
          className={`${colors.bg}`}
          style={{
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            borderLeft: `3px solid`,
            borderColor: nfiStatus === 'green' ? 'var(--icu-green)' : nfiStatus === 'amber' ? 'var(--icu-amber)' : 'var(--icu-red)',
            fontSize: 13,
            color: 'var(--icu-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {getNFIMessage(nfiStatus)}
          {nfiStatus === 'red' && (
            <InfoTooltip text="Danger Zone triggers when NFI drops below 94% (Vmax significantly below your 30-day baseline). This indicates accumulated CNS fatigue — continuing high-intensity work risks injury or prolonged performance loss. Prioritise sleep, nutrition, and light movement until NFI recovers above 97%." />
          )}
        </div>

        {/* ── 60-Day Trend Charts ──────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
          <TimeSeriesChart
            data={dailyTimeSeries}
            dataKey="nfi"
            title="Neural Readiness (60d)"
            color="var(--icu-green)"
            referenceLine={{ value: 0.97, label: '97%', color: 'var(--icu-amber)' }}
            formatValue={(v) => `${(v * 100).toFixed(1)}%`}
          />
          <TimeSeriesChart
            data={dailyTimeSeries}
            dataKey="tsb"
            title="Training Stress Balance (60d)"
            color="var(--icu-orange)"
            referenceLine={{ value: 0, label: '0', color: 'var(--icu-text-disabled)' }}
            formatValue={(v) => v.toFixed(0)}
          />
          <TimeSeriesChart
            data={dailyTimeSeries}
            dataKey="recoveryHours"
            title="Recovery Window (60d)"
            color="var(--icu-primary)"
            formatValue={(v) => `${v}h`}
          />
        </div>

        {/* ── Sprint Race Prep Row (shown only when sprint races are scheduled) ── */}
        {sprintRacePlans.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {sprintRacePlans.map((plan, index) => {
              const ctx = plan.priorRaceContext;
              const isPrimary = index === 0;
              const accentColor = isPrimary ? 'var(--icu-primary)' : 'var(--icu-text-secondary)';
              const accentBg = isPrimary ? 'rgba(33,150,243,0.12)' : 'rgba(255,255,255,0.05)';

              return (
                <div
                  key={plan.race.id}
                  className="icu-card"
                  style={{ borderLeft: `3px solid ${accentColor}`, marginBottom: 10 }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Flag size={16} style={{ color: accentColor }} />
                      <span className="icu-section-title" style={{ marginBottom: 0 }}>
                        {isPrimary ? 'Race Prep' : 'Future Race'}
                      </span>
                      <span className="icu-badge" style={{ background: accentBg, color: accentColor }}>
                        {plan.race.distanceM}m · {plan.race.daysUntil === 0 ? 'Today' : `${plan.race.daysUntil}d away`}
                      </span>
                      {!isPrimary && ctx && (
                        <span
                          className="icu-badge"
                          style={{ background: 'rgba(255,179,0,0.12)', color: 'var(--icu-amber)', fontSize: 10 }}
                        >
                          After {ctx.priorityRaceName}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>
                      {plan.race.name} · {plan.race.date}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>

                    {/* Panel 1: Race goal */}
                    <div className="icu-card-elevated" style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
                        Race Goal
                      </div>
                      <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: accentColor, lineHeight: 1, marginBottom: 4 }}>
                        {plan.goalTime}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>
                        {plan.race.distanceM}m · Age-adjusted Vmax estimate
                      </div>
                    </div>

                    {/* Panel 2: Current phase (or priority-race constraint) */}
                    <div className="icu-card-elevated" style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--icu-text-secondary)' }}>
                          {ctx?.isConstrained ? 'Now — Deferred' : 'Current Phase'}
                        </div>
                        <span className="icu-badge" style={{ background: accentBg, color: accentColor, fontSize: 10 }}>
                          {plan.currentPhase.label}
                        </span>
                        {ctx && (
                          <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>
                            {ctx.isConstrained
                              ? `${ctx.priorityRaceDaysUntil}d until ${ctx.priorityRaceName}`
                              : plan.currentPhase.timeframe}
                          </span>
                        )}
                        {!ctx && (
                          <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>
                            {plan.currentPhase.timeframe}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--icu-text)', fontWeight: 600, marginBottom: 6, lineHeight: 1.5 }}>
                        {plan.currentPhase.focus}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>
                        {plan.currentPhase.strengthNote}
                      </div>
                    </div>

                    {/* Panel 3a (primary race): Key Sessions now */}
                    {isPrimary && (
                      <div className="icu-card-elevated" style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
                          Key Sessions
                        </div>
                        <ul style={{ paddingLeft: 14, margin: 0 }}>
                          {plan.currentPhase.sessions.map((s, i) => (
                            <li key={i} style={{ fontSize: 12, color: 'var(--icu-text-secondary)', lineHeight: 1.7 }}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Panel 3b (secondary race): Post-priority-race build plan */}
                    {!isPrimary && ctx && (
                      <div className="icu-card-elevated" style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--icu-text-secondary)' }}>
                            Post-{ctx.priorityRaceName.split(' ')[0]} Plan
                          </div>
                          <span className="icu-badge" style={{ background: 'rgba(76,175,80,0.12)', color: 'var(--icu-green)', fontSize: 10 }}>
                            {ctx.postRecoveryPhase.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--icu-amber)', fontWeight: 600, marginBottom: 6 }}>
                          {ctx.recoveryDaysAfter}d recovery → {ctx.effectiveTrainingDays}d to train
                        </div>
                        <ul style={{ paddingLeft: 14, margin: 0 }}>
                          {ctx.postRecoveryPhase.sessions.map((s, i) => (
                            <li key={i} style={{ fontSize: 12, color: 'var(--icu-text-secondary)', lineHeight: 1.7 }}>{s}</li>
                          ))}
                        </ul>
                        <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 6 }}>
                          {ctx.postRecoveryPhase.strengthNote}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Training Prescriptions ─ Grid ────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>

          {/* ── Sprint Workout Card ────────────────────────── */}
          <div className="icu-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={16} style={{ color: nfiStatus === 'green' ? 'var(--icu-green)' : nfiStatus === 'amber' ? 'var(--icu-amber)' : 'var(--icu-red)' }} />
                <span className="icu-section-title" style={{ marginBottom: 0 }}>Sprint Workout Rx</span>
              </div>
              <div
                className="icu-badge"
                style={{
                  background: nfiStatus === 'green' ? 'rgba(76,175,80,0.15)' : nfiStatus === 'amber' ? 'rgba(255,179,0,0.15)' : 'rgba(244,67,54,0.15)',
                  color: nfiStatus === 'green' ? 'var(--icu-green)' : nfiStatus === 'amber' ? 'var(--icu-amber)' : 'var(--icu-red)',
                }}
              >
                <StatusIcon status={nfiStatus} size={12} />
                {nfiStatus.toUpperCase()}
              </div>
            </div>

            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{sprintWorkout.name}</h3>
            <p style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              {sprintWorkout.rationale}
            </p>

            {/* Expandable workout details */}
            <button
              onClick={() => setSprintExpanded(!sprintExpanded)}
              className="icu-btn-ghost"
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
            >
              <span>{sprintExpanded ? 'Hide' : 'Show'} workout details</span>
              {sprintExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {sprintExpanded && (
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ color: 'var(--icu-primary)', fontWeight: 600, marginBottom: 4 }}>WARM-UP</div>
                <ul style={{ paddingLeft: 16, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>
                  {sprintWorkout.warmup.map((w, i) => <li key={i}>{w}</li>)}
                </ul>

                <div style={{ color: 'var(--icu-primary)', fontWeight: 600, marginBottom: 4 }}>MAIN SET</div>
                <div style={{ marginBottom: 8 }}>
                  {sprintWorkout.mainSet.map((block, i) => (
                    <div
                      key={i}
                      className="icu-card-elevated"
                      style={{ marginBottom: 6, padding: '8px 12px' }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--icu-text)' }}>
                        {block.reps}× {block.name} — {block.distance}
                      </div>
                      <div style={{ color: 'var(--icu-text-secondary)', fontSize: 11 }}>
                        {block.intensity} · Rest: {block.rest}
                      </div>
                      <div style={{ color: 'var(--icu-text-disabled)', fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>
                        {block.cue}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ color: 'var(--icu-primary)', fontWeight: 600, marginBottom: 4 }}>COOL-DOWN</div>
                <ul style={{ paddingLeft: 16, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>
                  {sprintWorkout.cooldown.map((c, i) => <li key={i}>{c}</li>)}
                </ul>

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--icu-text-disabled)',
                    borderTop: '1px solid var(--icu-border)',
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  {sprintWorkout.totalSprintVolume}
                </div>
              </div>
            )}

            {/* Push to Intervals.icu */}
            <div
              style={{
                borderTop: '1px solid var(--icu-border)',
                marginTop: 8,
                paddingTop: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <input
                type="date"
                value={pushDate}
                onChange={(e) => setPushDate(e.target.value)}
                className="icu-input"
                style={{ flex: 1, maxWidth: 160, fontSize: 12 }}
              />
              <button
                className="icu-btn"
                onClick={handlePush}
                disabled={pushState === 'loading'}
                style={{ fontSize: 12 }}
              >
                <Send size={13} />
                {pushState === 'loading'
                  ? 'Pushing…'
                  : pushState === 'success'
                  ? 'Pushed ✓'
                  : pushState === 'error'
                  ? 'Failed ✕'
                  : 'Push to Intervals.icu'}
              </button>
            </div>
          </div>

          {/* ── Strength Training Card ─────────────────────── */}
          <div className="icu-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Dumbbell size={16} style={{ color: getStrengthZoneColor(strengthZone) }} />
                <span className="icu-section-title" style={{ marginBottom: 0 }}>Strength Rx</span>
              </div>
              <div
                className="icu-badge"
                style={{
                  background: strengthZone === 'fresh' ? 'rgba(76,175,80,0.15)' : strengthZone === 'tired' ? 'rgba(255,152,0,0.15)' : 'rgba(244,67,54,0.15)',
                  color: getStrengthZoneColor(strengthZone),
                  textTransform: 'capitalize',
                }}
              >
                {strengthZone}
              </div>
            </div>

            {/* Body weight for estimated loads */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--icu-text-secondary)' }}>Body weight</span>
              <input
                type="number"
                value={bodyWeight}
                onChange={(e) => {
                  setBodyWeight(e.target.value);
                  setBodyWeightAutoDetected(false);
                }}
                placeholder="kg"
                className="icu-input"
                style={{ width: 70, fontSize: 12, padding: '4px 8px' }}
                min={0}
                step={0.5}
              />
              <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>
                {bodyWeightAutoDetected ? 'from Intervals.icu' : 'kg (manual)'}
              </span>
            </div>

            {/* Exercises */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prescription.exercises.map((ex, i) => {
                const estKg = bwKg > 0 ? StrengthPeriodization.estimateWeightKg(ex, bwKg) : null;
                return (
                  <div key={i} className="icu-card-elevated" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{ex.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--icu-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {ex.sets}×{ex.reps}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>
                        {ex.intensity}
                        {ex.weightGuidance ? ` · ${ex.weightGuidance}` : ''}
                      </span>
                      {estKg != null && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'var(--icu-primary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          ~{estKg} kg
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Race Estimates Card ──────────────────────────── */}
        <div className="icu-card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Timer size={16} style={{ color: 'var(--icu-primary)' }} />
            <span className="icu-section-title" style={{ marginBottom: 0 }}>Outdoor Track Estimates</span>
            <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)', marginLeft: 'auto' }}>
              Training history · Age-adjusted · Readiness-modified
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {raceEstimates.map((est) => {
              const confidenceColor =
                est.confidence === 'high'
                  ? 'var(--icu-green)'
                  : est.confidence === 'moderate'
                  ? 'var(--icu-orange)'
                  : 'var(--icu-text-disabled)';

              // Find the corresponding "fully recovered" estimate (only present when amber/red)
              const recoveredEst = recoveredEstimates.find((r) => r.distance === est.distance);
              const timeDelta = recoveredEst && recoveredEst.predictedTime > 0 && est.predictedTime > 0
                ? est.predictedTime - recoveredEst.predictedTime
                : null;

              const totalPhaseTime = est.phases.reaction + est.phases.acceleration + est.phases.maxVelocity + est.phases.deceleration;
              const showPhases = totalPhaseTime > 0;

              return (
                <div
                  key={est.distance}
                  className="icu-card-elevated"
                  style={{ padding: '14px 16px', textAlign: 'center' }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--icu-text-secondary)',
                      marginBottom: 6,
                    }}
                  >
                    {est.distance}m
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--icu-text)',
                      lineHeight: 1,
                      marginBottom: 6,
                    }}
                  >
                    {est.display}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: confidenceColor,
                        display: 'inline-block',
                      }}
                    />
                    <span style={{ fontSize: 10, color: confidenceColor, textTransform: 'capitalize' }}>
                      {est.confidence} confidence
                    </span>
                  </div>

                  {/* Phase breakdown bar */}
                  {showPhases && (
                    <div style={{ margin: '8px 0 6px' }}>
                      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
                        <div
                          title={`Reaction: ${est.phases.reaction}s`}
                          style={{
                            flex: est.phases.reaction,
                            background: 'var(--icu-text-disabled)',
                            borderRadius: '3px 0 0 3px',
                          }}
                        />
                        <div
                          title={`Acceleration: ${est.phases.acceleration.toFixed(1)}s`}
                          style={{
                            flex: est.phases.acceleration,
                            background: 'var(--icu-orange)',
                          }}
                        />
                        <div
                          title={`Top speed: ${est.phases.maxVelocity.toFixed(1)}s`}
                          style={{
                            flex: est.phases.maxVelocity,
                            background: 'var(--icu-green)',
                          }}
                        />
                        {est.phases.deceleration > 0 && (
                          <div
                            title={`Speed endurance: ${est.phases.deceleration.toFixed(1)}s`}
                            style={{
                              flex: est.phases.deceleration,
                              background: 'var(--icu-red)',
                              borderRadius: '0 3px 3px 0',
                            }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 9,
                          color: 'var(--icu-text-disabled)',
                          marginTop: 3,
                        }}
                      >
                        <span>Accel {est.phases.acceleration.toFixed(1)}s</span>
                        <span>Top {est.phases.maxVelocity.toFixed(1)}s</span>
                        {est.phases.deceleration > 0.1 && (
                          <span>SE {est.phases.deceleration.toFixed(1)}s</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recovered estimate — shown only when amber/red */}
                  {recoveredEst && timeDelta != null && timeDelta > 0 && (
                    <div
                      style={{
                        margin: '6px 0 4px',
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: 'rgba(76,175,80,0.08)',
                        border: '1px solid rgba(76,175,80,0.18)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 2 }}>
                        <CheckCircle size={10} style={{ color: 'var(--icu-green)' }} />
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--icu-green)' }}>
                          If fully recovered
                        </span>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--icu-green)', lineHeight: 1 }}>
                        {recoveredEst.display}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--icu-text-disabled)', marginTop: 2 }}>
                        {timeDelta.toFixed(2)}s faster at green readiness
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)', lineHeight: 1.4 }}>
                    {est.note}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};