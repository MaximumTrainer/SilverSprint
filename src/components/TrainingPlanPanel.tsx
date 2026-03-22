/**
 * TrainingPlanPanel — 12-week sprint periodization panel
 *
 * Displays the current plan week, phase, this week's schedule summary,
 * and today's prescribed session with a push-to-Intervals.icu button.
 */

import React, { useState } from 'react';
import { Flag, Calendar, Send, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp, AlertTriangle, Zap, Target } from 'lucide-react';
import type { TrainingPlanContext } from '../domain/sprint/training-plan';
import { phaseBadgeLabel, sessionTypeLabel } from '../domain/sprint/training-plan';
import type { SprintWorkout } from '../domain/sprint/workouts';

interface TrainingPlanPanelProps {
  context: TrainingPlanContext;
  onPushWorkout: (workout: SprintWorkout, date: string) => Promise<boolean>;
}

const DAYS: Array<{ key: keyof TrainingPlanContext['plan'][0]['schedule']; label: string }> = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'Th' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'Su' },
];

const SESSION_COLOR: Record<string, string> = {
  acceleration:      'var(--icu-primary)',
  tempo:             'var(--icu-green)',
  speed_endurance:   'var(--icu-orange)',
  special_endurance: 'var(--icu-red)',
  race_specific:     '#c084fc',
  rest:              'var(--icu-text-disabled)',
};

const PHASE_BADGE_COLOR: Record<string, string> = {
  gpp:         'var(--icu-green)',
  spp:         'var(--icu-orange)',
  pre_comp:    'var(--icu-primary)',
  competition: 'var(--icu-red)',
};

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export const TrainingPlanPanel: React.FC<TrainingPlanPanelProps> = ({ context, onPushWorkout }) => {
  const [expanded, setExpanded] = useState(false);
  const [pushDate, setPushDate] = useState(getTomorrowDate());
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const { planWeek, phaseName, phase, weekTheme, todaySpec, todayWorkout, daysUntilRace, raceName, raceDistanceM, nfiAdjusted, nfiAdjustmentNote } = context;
  const weekSpec = context.plan[planWeek - 1];
  const phaseColor = PHASE_BADGE_COLOR[phase] ?? 'var(--icu-primary)';

  const handlePush = async () => {
    setPushState('loading');
    try {
      const ok = await onPushWorkout(todayWorkout, pushDate);
      setPushState(ok ? 'success' : 'error');
    } catch {
      setPushState('error');
    }
    setTimeout(() => setPushState('idle'), 4000);
  };

  return (
    <div className="icu-card" style={{ marginTop: 12 }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Target size={16} style={{ color: 'var(--icu-primary)' }} />
        <span className="icu-section-title" style={{ marginBottom: 0 }}>12-Week Sprint Plan</span>
        <span
          style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: phaseColor,
            background: `${phaseColor}1a`,
            padding: '2px 8px', borderRadius: 3,
            border: `1px solid ${phaseColor}40`,
          }}
        >
          {phaseBadgeLabel(phase)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--icu-text-secondary)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Flag size={12} style={{ color: phaseColor }} />
          {raceDistanceM}m · {daysUntilRace}d to {raceName}
        </span>
      </div>

      {/* ── Phase + Week Progress Bar ─────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--icu-text-secondary)' }}>{phaseName}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: phaseColor }}>Week {planWeek} of 12</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {Array.from({ length: 12 }, (_, i) => {
            const w = i + 1;
            const p = context.plan[i].phase;
            const pColor = PHASE_BADGE_COLOR[p];
            const isCurrent = w === planWeek;
            const isPast = w < planWeek;
            return (
              <div
                key={w}
                style={{
                  flex: 1,
                  height: isCurrent ? 8 : 5,
                  borderRadius: 3,
                  background: isCurrent ? pColor : isPast ? `${pColor}60` : 'var(--icu-border)',
                  transition: 'all 0.2s',
                  alignSelf: 'center',
                  outline: isCurrent ? `2px solid ${pColor}` : 'none',
                  outlineOffset: isCurrent ? 1 : 0,
                }}
                title={`Week ${w} — ${context.plan[i].phaseName}`}
              />
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)', marginTop: 3 }}>{weekTheme}</div>
      </div>

      {/* ── Weekly Schedule ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 14 }}>
        {DAYS.map(({ key, label }) => {
          const daySpec = weekSpec.schedule[key];
          const color = SESSION_COLOR[daySpec.sessionType] ?? 'var(--icu-text-disabled)';
          return (
            <div
              key={key}
              style={{
                textAlign: 'center',
                padding: '6px 2px',
                borderRadius: 4,
                background: 'var(--icu-surface)',
                border: `1px solid var(--icu-border)`,
              }}
              title={daySpec.label}
            >
              <div style={{ fontSize: 9, color: 'var(--icu-text-disabled)', marginBottom: 3 }}>{label}</div>
              <div
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: color,
                  margin: '0 auto 3px',
                }}
              />
              <div style={{ fontSize: 8, color: 'var(--icu-text-secondary)', lineHeight: 1.2 }}>
                {sessionTypeLabel(daySpec.sessionType)}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Today's Session ──────────────────────────────────── */}
      <div
        style={{
          background: 'var(--icu-surface)',
          border: `1px solid var(--icu-border)`,
          borderRadius: 6,
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Zap size={14} style={{ color: SESSION_COLOR[todaySpec.sessionType] ?? 'var(--icu-primary)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--icu-text)' }}>{todaySpec.label}</span>
          <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)', marginLeft: 'auto' }}>{todaySpec.volume}</span>
        </div>

        {/* NFI adjustment notice */}
        {nfiAdjusted && (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              background: 'var(--icu-orange)1a',
              border: '1px solid var(--icu-orange)40',
              borderRadius: 4,
              padding: '6px 10px',
              marginBottom: 8,
            }}
          >
            <AlertTriangle size={12} style={{ color: 'var(--icu-orange)', marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--icu-text-secondary)', lineHeight: 1.4 }}>{nfiAdjustmentNote}</span>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--icu-text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
          {todaySpec.notes}
        </div>

        {/* Workout preview (collapsible) */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="icu-btn-ghost"
          style={{
            width: '100%', textAlign: 'left', padding: '6px 0',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--icu-text-secondary)',
          }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Hide' : 'Show'} full workout details
        </button>

        {expanded && (
          <div style={{ marginTop: 8 }}>
            {/* Warmup */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--icu-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Warm-up</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {todayWorkout.warmup.map((w, i) => (
                  <li key={i} style={{ fontSize: 11, color: 'var(--icu-text-secondary)', lineHeight: 1.7, listStyleType: 'disc' }}>{w}</li>
                ))}
              </ul>
            </div>

            {/* Main Set */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--icu-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Main Set</div>
              {todayWorkout.mainSet.map((block, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--icu-bg)',
                    borderRadius: 4, padding: '8px 10px',
                    marginBottom: 6, border: '1px solid var(--icu-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--icu-text)' }}>{block.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: phaseColor }}>{block.reps}×</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--icu-text-secondary)', flexWrap: 'wrap' }}>
                    <span>📏 {block.distance}</span>
                    <span>⚡ {block.intensity}</span>
                    <span>⏱ {block.rest}</span>
                  </div>
                  {block.cue && (
                    <div style={{ fontSize: 11, color: 'var(--icu-primary)', marginTop: 4, fontStyle: 'italic' }}>↳ {block.cue}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Cooldown */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--icu-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Cool-down</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {todayWorkout.cooldown.map((c, i) => (
                  <li key={i} style={{ fontSize: 11, color: 'var(--icu-text-secondary)', lineHeight: 1.7, listStyleType: 'disc' }}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Push to Intervals.icu */}
        {todaySpec.sessionType !== 'rest' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--icu-border)' }}>
            <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>Schedule on Intervals.icu</span>
            <input
              type="date"
              value={pushDate}
              onChange={(e) => setPushDate(e.target.value)}
              style={{
                background: 'var(--icu-bg)', color: 'var(--icu-text)',
                border: '1px solid var(--icu-border)', borderRadius: 3,
                padding: '2px 6px', fontSize: 11, fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handlePush}
              disabled={pushState === 'loading' || pushState === 'success'}
              className="icu-btn-ghost"
              style={{
                padding: '4px 12px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                color:
                  pushState === 'success' ? 'var(--icu-green)'
                  : pushState === 'error' ? 'var(--icu-red)'
                  : 'var(--icu-primary)',
              }}
            >
              {pushState === 'loading' && <Clock size={11} className="animate-spin" />}
              {pushState === 'success' && <CheckCircle size={11} />}
              {pushState === 'error' && <XCircle size={11} />}
              {pushState === 'idle' && <Send size={11} />}
              {pushState === 'idle' ? 'Push' : pushState === 'loading' ? 'Pushing…' : pushState === 'success' ? 'Pushed!' : 'Failed'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
