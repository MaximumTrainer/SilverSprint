import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Wind, ChevronDown, ChevronUp, Battery, CheckSquare, BarChart2, Droplets, Brain, Zap, Play, Pause, RotateCcw, Plus, Minus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { FasciaPeriodization, AthleteType, FasciaDayPlan } from '../domain/recovery/fascia-periodization';
import { OscillatoryIsometric } from '../domain/recovery/oscillatory-isometric';
import { NeuralBudget, NeuralBudgetEntry } from '../domain/recovery/neural-budget';
import { ReadinessAssessment, MorningCheckIn, ReadinessResult } from '../domain/recovery/readiness';
import { RecoveryModalities } from '../domain/recovery/recovery-modalities';

// ── Types ──────────────────────────────────────────────────────────────────

type SpringTab = 'profile' | 'weekly-plan' | 'neural-budget' | 'morning-checkin' | 'oi-guide' | 'rsi-log' | 'recovery';
type RecoverySubTab = 'hydrotherapy' | 'breathing' | 'tempo';

interface RSILogEntry {
  date: string;           // ISO yyyy-MM-dd
  jumpHeightCm: number;
  contactTimeMs: number;
  rsi: number;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function hapticCue(pattern: number | number[]): void {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch { /* unsupported */ }
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function parseLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const CNS_DOT: Record<string, string> = {
  high: 'var(--icu-red)',
  low:  'var(--icu-green)',
  rest: 'var(--icu-text-disabled)',
};

const BUDGET_COLOR_VAR: Record<string, string> = {
  green: 'var(--icu-green)',
  amber: 'var(--icu-amber)',
  red:   'var(--icu-red)',
};

const TAB_LABELS: Record<SpringTab, string> = {
  'profile':        'Profile',
  'weekly-plan':    '4-Week Plan',
  'neural-budget':  'Neural Budget',
  'morning-checkin':'Check-In',
  'oi-guide':       'OI Guide',
  'rsi-log':        'RSI Log',
  'recovery':       'Recovery',
};

const STATUS_COLOR: Record<string, string> = {
  ready:           'var(--icu-green)',
  caution:         'var(--icu-amber)',
  'reduce-volume': 'var(--icu-red)',
};

// ── Main Component ─────────────────────────────────────────────────────────

export const SpringTrainingPanel: React.FC = () => {

  // Panel visibility
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<SpringTab>('profile');

  // ── localStorage-backed state ──────────────────────────────────────────

  const [dominanceProfile, setDominanceProfile] = useState<AthleteType>(
    () => (parseLocalJson<AthleteType>('ss_fascia_dominance_profile', 'fascia'))
  );

  const [currentWeek, setCurrentWeek] = useState<1|2|3|4>(
    () => Math.min(4, Math.max(1, parseLocalJson<number>('ss_fascia_current_week', 1))) as 1|2|3|4
  );

  const [budgetEntries, setBudgetEntries] = useState<NeuralBudgetEntry[]>(
    () => parseLocalJson<NeuralBudgetEntry[]>('ss_neural_budget_entries', [])
  );

  const [checkIns, setCheckIns] = useState<MorningCheckIn[]>(
    () => parseLocalJson<MorningCheckIn[]>('ss_morning_checkins', [])
  );

  const [rsiLog, setRsiLog] = useState<RSILogEntry[]>(
    () => parseLocalJson<RSILogEntry[]>('ss_rsi_log', [])
  );

  // ── Persist effects ────────────────────────────────────────────────────

  useEffect(() => { localStorage.setItem('ss_fascia_dominance_profile', dominanceProfile); }, [dominanceProfile]);
  useEffect(() => { localStorage.setItem('ss_fascia_current_week', String(currentWeek)); }, [currentWeek]);
  useEffect(() => { localStorage.setItem('ss_neural_budget_entries', JSON.stringify(budgetEntries)); }, [budgetEntries]);
  useEffect(() => { localStorage.setItem('ss_morning_checkins', JSON.stringify(checkIns.slice(0, 30))); }, [checkIns]);
  useEffect(() => { localStorage.setItem('ss_rsi_log', JSON.stringify(rsiLog.slice(0, 90))); }, [rsiLog]);

  // ── Morning check-in form state ────────────────────────────────────────

  const [gripScore, setGripScore] = useState<'ok'|'reduced'>('ok');
  const [tapRatio, setTapRatio] = useState<string>('1.00');
  const [muscleFeeling, setMuscleFeeling] = useState<'twitchy'|'normal'|'heavy'>('normal');
  const [stiffnessCleared, setStiffnessCleared] = useState(true);
  const [checkInResult, setCheckInResult] = useState<ReadinessResult | null>(null);

  // ── OI guide state ─────────────────────────────────────────────────────

  const [relaxationScore, setRelaxationScore] = useState(7);
  const [pulsesHz, setPulsesHz] = useState<string>('4.0');

  // ── RSI log form state ─────────────────────────────────────────────────

  const [jumpHeightCm, setJumpHeightCm] = useState<string>('');
  const [contactTimeMs, setContactTimeMs] = useState<string>('');

  // ── Recovery timers ────────────────────────────────────────────────────

  const [recoverySubTab, setRecoverySubTab] = useState<RecoverySubTab>('hydrotherapy');

  // Hydrotherapy timer
  const [hydroStep, setHydroStep] = useState(0);
  const [hydroCycle, setHydroCycle] = useState(0);
  const [hydroTimerSec, setHydroTimerSec] = useState<number | null>(null);
  const [hydroRunning, setHydroRunning] = useState(false);
  const hydroRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Breathing timer
  const [breathPhase, setBreathPhase] = useState(0);
  const [breathCycle, setBreathCycle] = useState(0);
  const [breathTimerSec, setBreathTimerSec] = useState<number | null>(null);
  const [breathRunning, setBreathRunning] = useState(false);
  const breathRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derived / memoized values ──────────────────────────────────────────

  const weeklyPlan = useMemo(
    () => FasciaPeriodization.generateWeeklyPlan(currentWeek, dominanceProfile),
    [currentWeek, dominanceProfile]
  );

  const oiPhaseName = useMemo(() => OscillatoryIsometric.getPhase(currentWeek), [currentWeek]);
  const oiExercises = useMemo(() => OscillatoryIsometric.getExercises(oiPhaseName), [oiPhaseName]);

  const todayBudgetEntries = useMemo(
    () => budgetEntries.filter(e => e.date === today()),
    [budgetEntries]
  );

  const todayBudget = useMemo(
    () => NeuralBudget.calculateDailyBudget(todayBudgetEntries),
    [todayBudgetEntries]
  );

  const budgetColor = useMemo(() => NeuralBudget.getBudgetColor(todayBudget), [todayBudget]);

  const last7BudgetColors = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split('T')[0];
      const dayEntries = budgetEntries.filter(e => e.date === dateStr);
      const b = NeuralBudget.calculateDailyBudget(dayEntries);
      return { dateStr, b, color: NeuralBudget.getBudgetColor(b) };
    });
  }, [budgetEntries]);

  const requiresReset = useMemo(() => {
    const last2 = last7BudgetColors.slice(-2).map(x => x.b) as [number, number];
    return last2.length === 2 ? NeuralBudget.requiresNeuralResetDay(last2) : false;
  }, [last7BudgetColors]);

  const relaxResult = useMemo(
    () => OscillatoryIsometric.calculateRelaxationScore(relaxationScore as any),
    [relaxationScore]
  );

  const pulsesHzNum = parseFloat(pulsesHz) || 0;
  const velocityFatigue = OscillatoryIsometric.isVelocityLossFatigue(pulsesHzNum);

  const tempoProtocol = useMemo(() => RecoveryModalities.getTempoProtocol(dominanceProfile), [dominanceProfile]);
  const breathingGuide = useMemo(() => RecoveryModalities.getBreathingProtocol(), []);
  const hydroGuide = useMemo(() => RecoveryModalities.getHydrotherapyProtocol('max-velocity'), []);
  const hydroWarning = RecoveryModalities.getContrastBathWarning('max-velocity');

  const rsiLogRecent = useMemo(() => rsiLog.slice(0, 20).reverse(), [rsiLog]);

  const rsiPreview = useMemo(() => {
    const h = parseFloat(jumpHeightCm);
    const c = parseFloat(contactTimeMs);
    if (!h || !c || c <= 0) return null;
    return (h / 100) / (c / 1000);
  }, [jumpHeightCm, contactTimeMs]);

  const rsiTrend = useMemo(() => {
    if (rsiLog.length < 2) return null;
    const recent = rsiLog.slice(0, 5).reduce((s, e) => s + e.rsi, 0) / Math.min(5, rsiLog.length);
    const older  = rsiLog.slice(5, 15);
    if (older.length === 0) return null;
    const olderAvg = older.reduce((s, e) => s + e.rsi, 0) / older.length;
    if (recent > olderAvg * 1.03) return 'Improving';
    if (recent < olderAvg * 0.97) return 'Declining';
    return 'Stable';
  }, [rsiLog]);

  // ── Hydrotherapy timer logic ───────────────────────────────────────────

  const startHydroTimer = useCallback(() => {
    if (hydroTimerSec === null) {
      setHydroTimerSec(hydroGuide.steps[0].durationSeconds);
    }
    setHydroRunning(true);
  }, [hydroTimerSec, hydroGuide]);

  useEffect(() => {
    if (!hydroRunning) {
      if (hydroRef.current) clearInterval(hydroRef.current);
      return;
    }
    hydroRef.current = setInterval(() => {
      setHydroTimerSec(prev => {
        if (prev === null || prev <= 0) return prev;
        if (prev === 1) {
          // advance step
          setHydroStep(step => {
            const nextStep = (step + 1) % hydroGuide.steps.length;
            if (nextStep === 0) {
              setHydroCycle(c => {
                const nextCycle = c + 1;
                if (nextCycle >= hydroGuide.totalCycles) {
                  setHydroRunning(false);
                  hapticCue([300, 100, 300, 100, 300]);
                  return nextCycle;
                }
                return nextCycle;
              });
            }
            hapticCue([200, 100, 200]);
            return nextStep;
          });
          return hydroGuide.steps[0].durationSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (hydroRef.current) clearInterval(hydroRef.current); };
  }, [hydroRunning, hydroGuide]);

  const resetHydro = () => {
    setHydroRunning(false);
    setHydroStep(0);
    setHydroCycle(0);
    setHydroTimerSec(null);
  };

  // ── Breathing timer logic ──────────────────────────────────────────────

  const startBreathTimer = useCallback(() => {
    if (breathTimerSec === null) {
      setBreathTimerSec(breathingGuide.steps[0].durationSeconds);
    }
    setBreathRunning(true);
  }, [breathTimerSec, breathingGuide]);

  useEffect(() => {
    if (!breathRunning) {
      if (breathRef.current) clearInterval(breathRef.current);
      return;
    }
    breathRef.current = setInterval(() => {
      setBreathTimerSec(prev => {
        if (prev === null || prev <= 0) return prev;
        if (prev === 1) {
          setBreathPhase(phase => {
            const nextPhase = (phase + 1) % breathingGuide.steps.length;
            if (nextPhase === 0) {
              setBreathCycle(c => {
                const next = c + 1;
                if (next >= breathingGuide.cycles) {
                  setBreathRunning(false);
                  hapticCue([300, 100, 300, 100, 300]);
                }
                return next;
              });
            }
            hapticCue(100);
            return nextPhase;
          });
          return breathingGuide.steps[0].durationSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (breathRef.current) clearInterval(breathRef.current); };
  }, [breathRunning, breathingGuide]);

  const resetBreath = () => {
    setBreathRunning(false);
    setBreathPhase(0);
    setBreathCycle(0);
    setBreathTimerSec(null);
  };

  // ── Budget quick-add ──────────────────────────────────────────────────

  const addBudgetEntry = (type: NeuralBudgetEntry['type'], value: number) => {
    setBudgetEntries(prev => [...prev, { date: today(), type, value }]);
    hapticCue(50);
  };

  // ── Morning check-in submit ────────────────────────────────────────────

  const submitCheckIn = () => {
    const checkIn: MorningCheckIn = {
      date: today(),
      gripScore,
      tapTestRatio: parseFloat(tapRatio) || 1.0,
      muscleFeeling,
      morningStiffnessCleared: stiffnessCleared,
    };
    const result = ReadinessAssessment.assess(checkIn);
    setCheckInResult(result);
    setCheckIns(prev => [checkIn, ...prev].slice(0, 30));
    hapticCue(50);
  };

  // ── RSI log entry ─────────────────────────────────────────────────────

  const logRSI = () => {
    if (!rsiPreview) return;
    const entry: RSILogEntry = {
      date: today(),
      jumpHeightCm: parseFloat(jumpHeightCm),
      contactTimeMs: parseFloat(contactTimeMs),
      rsi: rsiPreview,
    };
    setRsiLog(prev => [entry, ...prev].slice(0, 90));
    setJumpHeightCm('');
    setContactTimeMs('');
    hapticCue(50);
  };

  // ── Render helpers ────────────────────────────────────────────────────

  const phaseLabel = (day: FasciaDayPlan) => {
    if (day.phaseName === 'Deload') return { text: 'Deload −45%', color: 'var(--icu-green)' };
    if (day.phaseName === 'Intensification') return { text: 'Intensification', color: 'var(--icu-orange)' };
    return { text: 'Accumulation', color: 'var(--icu-primary)' };
  };

  // ── Tab renders ───────────────────────────────────────────────────────

  const renderProfileTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Athlete Dominance Type</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['fascia', 'muscle'] as AthleteType[]).map(type => (
            <button
              key={type}
              onClick={() => setDominanceProfile(type)}
              className={dominanceProfile === type ? 'icu-btn' : 'icu-btn-ghost'}
              style={{ flex: 1, textTransform: 'capitalize', padding: '10px 16px' }}
            >
              {type === 'fascia' ? 'Fascia-Driven' : 'Muscle-Driven'}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--icu-surface)', borderRadius: 6, fontSize: 12, color: 'var(--icu-text-secondary)', lineHeight: 1.6 }}>
          {dominanceProfile === 'fascia'
            ? 'Spring / elastic type. Excels in reactive recoil. Training emphasises OI volume, reduced heavy lifting, and high plyometric frequency.'
            : 'Grinder / strength type. Responds to higher loading. Training substitutes some OI for controlled tempo work, with maintained strength volume.'}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Current Training Week</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([1, 2, 3, 4] as const).map(w => (
            <button
              key={w}
              onClick={() => setCurrentWeek(w)}
              className={currentWeek === w ? 'icu-btn' : 'icu-btn-ghost'}
              style={{ flex: 1, padding: '8px 0' }}
            >
              {w === 4 ? 'W4 Deload' : `Week ${w}`}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--icu-text-disabled)' }}>
          Weeks 1–2: Accumulation &nbsp;|&nbsp; Week 3: Intensification &nbsp;|&nbsp; Week 4: Deload (-45% vol)
        </div>
      </div>

      <div style={{ padding: '10px 12px', border: '1px solid var(--icu-border)', borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>OI Phase: {currentWeek <= 2 ? 'Catch-and-Hold' : currentWeek === 3 ? 'Rapid Pulses' : 'Reactive Switch'}</div>
        <div style={{ color: 'var(--icu-text-secondary)' }}>
          {currentWeek <= 2 && 'Drop to position, stop instantly, hold 3s. Build eccentric "brakes" and tendon stiffness.'}
          {currentWeek === 3 && 'Rapid 1–2" pulses for 5–10s. CNS on/off switch training. Terminate if pulse rate drops below 3Hz.'}
          {currentWeek >= 4 && 'Drop from standing, begin oscillation immediately. Integrates relaxation→tension at high velocity.'}
        </div>
      </div>
    </div>
  );

  const renderWeeklyPlanTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${phaseLabel(weeklyPlan[0]).color} 15%, transparent)`, color: phaseLabel(weeklyPlan[0]).color }}>
          {phaseLabel(weeklyPlan[0]).text}
        </span>
        <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>Week {currentWeek} · {dominanceProfile === 'fascia' ? 'Fascia-Driven' : 'Muscle-Driven'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {weeklyPlan.map(day => (
          <div key={day.day} className="icu-card" style={{ padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{day.day}</span>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: CNS_DOT[day.cnsDemand],
                flexShrink: 0,
              }} title={`CNS: ${day.cnsDemand}`} />
              <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)', textTransform: 'capitalize' }}>{day.cnsDemand} CNS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {day.primaryMovements.map((m, i) => (
                <div key={i} style={{ fontSize: 11, lineHeight: 1.4 }}>
                  <span style={{ color: 'var(--icu-text)' }}>{m.name}</span>
                  <span style={{ color: 'var(--icu-text-disabled)', marginLeft: 4 }}>{m.sets}× {m.repsOrDuration}</span>
                  {m.notes && <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)', fontStyle: 'italic' }}>{m.notes}</div>}
                </div>
              ))}
            </div>
            {day.exercises.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--icu-border)' }}>
                {day.exercises.map((ex, i) => (
                  <div key={i} style={{ fontSize: 10, color: 'var(--icu-text-secondary)', lineHeight: 1.5 }}>· {ex}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', display: 'flex', gap: 12 }}>
        <span>● High CNS</span>
        <span style={{ color: 'var(--icu-green)' }}>● Low CNS</span>
        <span style={{ color: 'var(--icu-text-disabled)' }}>● Rest day</span>
      </div>
    </div>
  );

  const renderNeuralBudgetTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {requiresReset && (
        <div style={{ padding: '10px 12px', background: 'color-mix(in srgb, var(--icu-red) 15%, transparent)', border: '1px solid var(--icu-red)', borderRadius: 6, fontSize: 12, color: 'var(--icu-red)' }}>
          Neural Reset Day required — budget below 20% for 2 consecutive days. Total rest or parasympathetic focus only.
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Today's Neural Budget</div>
        <div style={{ position: 'relative', height: 36, background: 'var(--icu-surface)', borderRadius: 6, border: '2px solid var(--icu-border)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${todayBudget}%`, background: BUDGET_COLOR_VAR[budgetColor], transition: 'width 0.4s ease, background 0.4s ease', borderRadius: 4 }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
            {todayBudget}%
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 4 }}>Baseline: 50 &nbsp;·&nbsp; Resets daily</div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Quick Add</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            { label: 'Sprint −30', type: 'high-intensity' as const, value: 1 },
            { label: 'OI/Lift −20', type: 'oscillatory' as const, value: 1 },
            { label: 'Sleep 8h +40', type: 'sleep' as const, value: 8 },
            { label: 'Sleep 6h +30', type: 'sleep' as const, value: 6 },
            { label: 'Tempo +10', type: 'tempo' as const, value: 1 },
          ].map(btn => (
            <button key={btn.label} className="icu-btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => addBudgetEntry(btn.type, btn.value)}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Last 7 Days</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {last7BudgetColors.map(({ dateStr, b, color }) => (
            <div key={dateStr} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: '100%', height: 28, borderRadius: 4, background: BUDGET_COLOR_VAR[color], opacity: 0.8 }} title={`${dateStr}: ${b}%`} />
              <span style={{ fontSize: 9, color: 'var(--icu-text-disabled)' }}>{dateStr.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--icu-text-secondary)', padding: '8px 10px', background: 'var(--icu-surface)', borderRadius: 6, lineHeight: 1.6 }}>
        <strong>Budget formula:</strong> Baseline 50 &nbsp;·&nbsp; Sprint −30 &nbsp;·&nbsp; OI/Lift −20 &nbsp;·&nbsp; Sleep +5/hr &nbsp;·&nbsp; Tempo +10
      </div>
    </div>
  );

  const renderCheckInTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>Grip Strength</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ok', 'reduced'] as const).map(g => (
            <button key={g} onClick={() => setGripScore(g)} className={gripScore === g ? 'icu-btn' : 'icu-btn-ghost'}
              style={{ flex: 1, textTransform: 'capitalize' }}>
              {g === 'ok' ? 'Normal' : 'Reduced (>10% drop)'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
          Tap Test Ratio &nbsp;<span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>(today ÷ 7-day avg — 1.0 = baseline)</span>
        </div>
        <input className="icu-input" type="number" min="0.5" max="1.5" step="0.01"
          value={tapRatio} onChange={e => setTapRatio(e.target.value)}
          style={{ width: 120 }} />
        {parseFloat(tapRatio) < 0.85 && (
          <div style={{ fontSize: 11, color: 'var(--icu-red)', marginTop: 4 }}>
            {Math.round((1 - parseFloat(tapRatio)) * 100)}% below baseline — red flag
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>Muscle Feeling</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['twitchy', 'normal', 'heavy'] as const).map(f => (
            <button key={f} onClick={() => setMuscleFeeling(f)} className={muscleFeeling === f ? 'icu-btn' : 'icu-btn-ghost'}
              style={{ flex: 1, textTransform: 'capitalize', fontSize: 12 }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" id="stiffness-clear" checked={stiffnessCleared} onChange={e => setStiffnessCleared(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }} />
        <label htmlFor="stiffness-clear" style={{ fontSize: 12, cursor: 'pointer' }}>
          Morning stiffness cleared within ~10 minutes of waking
        </label>
      </div>

      <button className="icu-btn" onClick={submitCheckIn} style={{ alignSelf: 'flex-start' }}>
        Submit Check-In
      </button>

      {checkInResult && (
        <div style={{ padding: '12px', border: `1px solid ${STATUS_COLOR[checkInResult.overallStatus]}`, borderRadius: 6, background: `color-mix(in srgb, ${STATUS_COLOR[checkInResult.overallStatus]} 10%, transparent)` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: STATUS_COLOR[checkInResult.overallStatus], textTransform: 'uppercase' }}>
              {checkInResult.overallStatus.replace('-', ' ')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>Neural Score: {checkInResult.neuralScore}/100</span>
          </div>
          {checkInResult.redFlags.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--icu-red)', marginBottom: 3 }}>⚠ {f}</div>
          ))}
          {checkInResult.recommendations.map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginTop: 3 }}>→ {r}</div>
          ))}
        </div>
      )}

      {checkIns.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>Recent Check-Ins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {checkIns.slice(0, 5).map((c, i) => {
              const r = ReadinessAssessment.assess(c);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--icu-text-secondary)' }}>
                  <span style={{ color: 'var(--icu-text-disabled)', minWidth: 72 }}>{c.date}</span>
                  <span style={{ color: STATUS_COLOR[r.overallStatus], fontWeight: 600, minWidth: 90, textTransform: 'uppercase', fontSize: 10 }}>
                    {r.overallStatus.replace('-', ' ')}
                  </span>
                  <span>{r.neuralScore}/100</span>
                  {r.redFlags.length > 0 && <span style={{ color: 'var(--icu-red)' }}>{r.redFlags.length} flag{r.redFlags.length > 1 ? 's' : ''}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderOIGuideTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '10px 12px', background: 'var(--icu-surface)', borderRadius: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Phase {currentWeek <= 2 ? '1' : currentWeek === 3 ? '2' : '3'}: {oiPhaseName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </div>
        <div style={{ fontSize: 11, color: 'var(--icu-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
          {currentWeek <= 2 && 'Build eccentric deceleration — catch, absorb, hold. Time to stabilisation is your key metric.'}
          {currentWeek === 3 && 'Rapid 1–2" pulses at maximum speed. If pulse frequency drops below 3Hz, the set ends.'}
          {currentWeek >= 4 && 'Drop into position and immediately begin oscillation. High-velocity relaxation → tension transition.'}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
          Relaxation Score &nbsp;
          <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>How fluid vs heavy did the pulses feel? (1–10)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min={1} max={10} value={relaxationScore}
            onChange={e => setRelaxationScore(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: relaxResult.isAdequate ? 'var(--icu-green)' : 'var(--icu-red)' }} />
          <span style={{ fontWeight: 700, fontSize: 16, minWidth: 24, textAlign: 'right' }}>{relaxationScore}</span>
        </div>
        <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: `color-mix(in srgb, ${relaxResult.isAdequate ? 'var(--icu-green)' : 'var(--icu-red)'} 12%, transparent)`, fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: relaxResult.isAdequate ? 'var(--icu-green)' : 'var(--icu-red)' }}>{relaxResult.label}: </span>
          {relaxResult.assessment}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
          Velocity-Loss Check &nbsp;
          <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>(pulses per second during set)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="icu-input" type="number" min="0" max="10" step="0.1"
            value={pulsesHz} onChange={e => setPulsesHz(e.target.value)} style={{ width: 90 }} />
          <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>Hz (pulses/sec)</span>
          {pulsesHz && (
            <span style={{ fontSize: 12, fontWeight: 600, color: velocityFatigue ? 'var(--icu-red)' : 'var(--icu-green)' }}>
              {velocityFatigue ? '⚠ Neural fatigue — stop set' : '✓ Adequate rate'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 4 }}>Threshold: 3.0 Hz minimum</div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Exercises — {oiPhaseName.replace(/-/g, ' ')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {oiExercises.map((ex, i) => (
            <div key={i} className="icu-card" style={{ padding: '10px 12px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{ex.name}</div>
              <div style={{ fontSize: 11, color: 'var(--icu-primary)', marginBottom: 4 }}>{ex.benefit}</div>
              <div style={{ fontSize: 11, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>
                <strong>Volume:</strong> {ex.duration} &nbsp;·&nbsp; <strong>Focus:</strong> {ex.focusArea}
              </div>
              <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', fontStyle: 'italic', marginBottom: 8, lineHeight: 1.5 }}>
                "{ex.cue}"
              </div>
              <button className="icu-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => hapticCue([100, 50, 100])}>
                Mark Set Complete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderRSILogTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '10px 12px', background: 'var(--icu-surface)', borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
        <strong>Reactive Strength Index (RSI)</strong> = Jump Height (m) ÷ Ground Contact Time (s).
        A rising RSI indicates improving tendon stiffness and elastic efficiency.
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>Log Depth Jump Result</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginBottom: 3 }}>Jump Height (cm)</div>
            <input className="icu-input" type="number" min="0" max="100" step="0.5"
              value={jumpHeightCm} onChange={e => setJumpHeightCm(e.target.value)}
              placeholder="e.g. 38" style={{ width: 100 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginBottom: 3 }}>Contact Time (ms)</div>
            <input className="icu-input" type="number" min="0" max="500" step="1"
              value={contactTimeMs} onChange={e => setContactTimeMs(e.target.value)}
              placeholder="e.g. 200" style={{ width: 100 }} />
          </div>
          <div>
            {rsiPreview !== null && (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--icu-primary)', marginBottom: 6 }}>
                RSI: {rsiPreview.toFixed(2)}
              </div>
            )}
            <button className="icu-btn" onClick={logRSI} disabled={!rsiPreview}>
              Log Entry
            </button>
          </div>
        </div>
      </div>

      {rsiTrend && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--icu-text-secondary)' }}>Trend:</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: rsiTrend === 'Improving' ? 'var(--icu-green)' : rsiTrend === 'Declining' ? 'var(--icu-red)' : 'var(--icu-amber)' }}>
            {rsiTrend === 'Improving' ? '↑ Improving' : rsiTrend === 'Declining' ? '↓ Declining' : '→ Stable'}
          </span>
        </div>
      )}

      {rsiLogRecent.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 8 }}>RSI History (last {rsiLogRecent.length})</div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rsiLogRecent} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--icu-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--icu-text-disabled)' }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--icu-text-disabled)' }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--icu-surface)', border: '1px solid var(--icu-border)', fontSize: 11 }} />
                <ReferenceLine y={1.5} stroke="var(--icu-amber)" strokeDasharray="4 2" label={{ value: 'Avg', fontSize: 9, fill: 'var(--icu-amber)' }} />
                <Line type="monotone" dataKey="rsi" stroke="var(--icu-primary)" strokeWidth={2} dot={{ r: 3 }} name="RSI" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--icu-text-disabled)', textAlign: 'center', padding: 24 }}>
          No RSI entries yet. Log your first depth jump result above.
        </div>
      )}

      {rsiLog.length >= 5 && (() => {
        const baseline = rsiLog.slice(0, 5).reduce((s, e) => s + e.rsi, 0) / 5;
        const latest = rsiLog[0]?.rsi ?? 0;
        const dropping = ReadinessAssessment.isRSIDropping(latest, baseline);
        return dropping ? (
          <div style={{ padding: '10px 12px', background: 'color-mix(in srgb, var(--icu-red) 12%, transparent)', border: '1px solid var(--icu-red)', borderRadius: 6, fontSize: 12, color: 'var(--icu-red)' }}>
            ⚠ RSI has dropped &gt;10% below recent baseline. Swap Friday Max Velocity for Extensive Tempo.
          </div>
        ) : null;
      })()}
    </div>
  );

  const renderRecoveryTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['hydrotherapy', 'breathing', 'tempo'] as RecoverySubTab[]).map(sub => (
          <button key={sub} onClick={() => setRecoverySubTab(sub)}
            className={recoverySubTab === sub ? 'icu-btn' : 'icu-btn-ghost'}
            style={{ flex: 1, fontSize: 12, padding: '7px 0', textTransform: 'capitalize' }}>
            {sub}
          </button>
        ))}
      </div>

      {recoverySubTab === 'hydrotherapy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {hydroWarning && (
            <div style={{ padding: '8px 10px', background: 'color-mix(in srgb, var(--icu-amber) 12%, transparent)', border: '1px solid var(--icu-amber)', borderRadius: 6, fontSize: 11, color: 'var(--icu-amber)', lineHeight: 1.5 }}>
              ⚠ {hydroWarning}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Cycle {hydroCycle + 1} of {hydroGuide.totalCycles}</span>
            <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>~{hydroGuide.totalDurationMinutes} min total</span>
          </div>
          <div style={{ padding: '12px', background: hydroGuide.steps[hydroStep]?.temperature === 'hot' ? 'color-mix(in srgb, var(--icu-red) 15%, transparent)' : 'color-mix(in srgb, var(--icu-primary) 15%, transparent)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
              {hydroGuide.steps[hydroStep]?.temperature === 'hot' ? '🔥 HOT' : '❄  COLD'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {hydroTimerSec !== null ? `${Math.floor(hydroTimerSec / 60)}:${String(hydroTimerSec % 60).padStart(2, '0')}` : `${Math.floor(hydroGuide.steps[hydroStep]?.durationSeconds / 60)}:${String(hydroGuide.steps[hydroStep]?.durationSeconds % 60).padStart(2, '0')}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
              {hydroGuide.steps[hydroStep]?.notes}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="icu-btn" onClick={hydroRunning ? () => setHydroRunning(false) : startHydroTimer} style={{ flex: 1 }}>
              {hydroRunning ? 'Pause' : hydroTimerSec !== null ? 'Resume' : 'Start'}
            </button>
            <button className="icu-btn-ghost" onClick={resetHydro}>Reset</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', lineHeight: 1.5 }}>
            <strong>Contraindications:</strong> {hydroGuide.contraindications}
          </div>
        </div>
      )}

      {recoverySubTab === 'breathing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '10px 12px', background: 'var(--icu-surface)', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>90/90 Diaphragmatic Breathing</div>
            <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', lineHeight: 1.5 }}>
              {breathingGuide.benefit}
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: '16px', background: 'color-mix(in srgb, var(--icu-primary) 10%, transparent)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              {breathingGuide.steps[breathPhase]?.phase}
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--icu-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {breathTimerSec !== null ? breathTimerSec : breathingGuide.steps[breathPhase]?.durationSeconds}
            </div>
            <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginTop: 6, lineHeight: 1.5, maxWidth: 320, margin: '8px auto 0' }}>
              {breathingGuide.steps[breathPhase]?.instruction}
            </div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginTop: 8 }}>
              Cycle {breathCycle + 1} of {breathingGuide.cycles}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="icu-btn" onClick={breathRunning ? () => setBreathRunning(false) : startBreathTimer} style={{ flex: 1 }}>
              {breathRunning ? 'Pause' : breathTimerSec !== null ? 'Resume' : 'Start 5-min Guide'}
            </button>
            <button className="icu-btn-ghost" onClick={resetBreath}>Reset</button>
          </div>
        </div>
      )}

      {recoverySubTab === 'tempo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '10px 12px', background: 'var(--icu-surface)', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{tempoProtocol.name}</div>
            <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', lineHeight: 1.5 }}>{tempoProtocol.description}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: 'Distance', value: tempoProtocol.distance },
              { label: 'Intensity', value: tempoProtocol.intensity },
              { label: 'Rest', value: tempoProtocol.restInterval },
            ].map(item => (
              <div key={item.label} style={{ padding: '8px', background: 'var(--icu-surface)', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)', marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--icu-text-secondary)', marginBottom: 6 }}>Cues</div>
            {tempoProtocol.cues.map((c, i) => (
              <div key={i} style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--icu-text-secondary)' }}>· {c}</div>
            ))}
          </div>
          {tempoProtocol.contraindications.length > 0 && (
            <div style={{ padding: '8px 10px', background: 'color-mix(in srgb, var(--icu-amber) 10%, transparent)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--icu-amber)', fontWeight: 600, marginBottom: 4 }}>Contraindications</div>
              {tempoProtocol.contraindications.map((c, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--icu-text-secondary)' }}>· {c}</div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', fontStyle: 'italic' }}>
            Note: GPS tracking not available on web. Use a running watch or phone GPS app to monitor pace.
          </div>
        </div>
      )}
    </div>
  );

  // ── Root render ───────────────────────────────────────────────────────────

  return (
    <div className="icu-card" style={{ marginTop: 12 }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="icu-btn-ghost"
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wind size={16} style={{ color: 'var(--icu-primary)' }} />
          <span className="icu-section-title" style={{ marginBottom: 0 }}>Spring Training — Fascia Module</span>
          <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)', padding: '2px 6px', border: '1px solid var(--icu-border)', borderRadius: 3 }}>
            Speed Strength
          </span>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isExpanded && (
        <div style={{ marginTop: 12 }}>
          {/* Tab navigation */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--icu-border)', paddingBottom: 8, marginBottom: 16 }}>
            {(Object.keys(TAB_LABELS) as SpringTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={activeTab === tab ? 'icu-btn' : 'icu-btn-ghost'}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Active tab content */}
          {activeTab === 'profile'         && renderProfileTab()}
          {activeTab === 'weekly-plan'     && renderWeeklyPlanTab()}
          {activeTab === 'neural-budget'   && renderNeuralBudgetTab()}
          {activeTab === 'morning-checkin' && renderCheckInTab()}
          {activeTab === 'oi-guide'        && renderOIGuideTab()}
          {activeTab === 'rsi-log'         && renderRSILogTab()}
          {activeTab === 'recovery'        && renderRecoveryTab()}
        </div>
      )}
    </div>
  );
};
