import React from 'react';
import { CalendarClock, Clock, Dumbbell, Zap } from 'lucide-react';
import type { DayRecommendation, TwoDayPlan } from '../domain/sprint/daily-plan';

interface TwoDayPlanPanelProps {
  plan: TwoDayPlan;
}

function zoneColor(zone: string): string {
  switch (zone) {
    case 'fresh': return 'var(--icu-green)';
    case 'tired': return 'var(--icu-orange)';
    case 'fatigued': return 'var(--icu-red)';
    default: return 'var(--icu-text-secondary)';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'green': return 'var(--icu-green)';
    case 'amber': return 'var(--icu-orange)';
    case 'red': return 'var(--icu-red)';
    default: return 'var(--icu-text-secondary)';
  }
}

/** "in ~14h" / "in ~3d", or null once the window has cleared. */
function formatRemaining(hours: number): string | null {
  if (hours <= 0) return null;
  if (hours < 24) return `in ~${Math.round(hours)}h`;
  return `in ~${Math.round(hours / 24)}d`;
}

const SOURCE_LABEL: Record<DayRecommendation['tsbSource'], string> = {
  recorded: 'Measured',
  projected: 'Forecast',
  modelled: 'If you rest',
};

const DayCard: React.FC<{ day: DayRecommendation }> = ({ day }) => {
  const remaining = formatRemaining(day.recovery.hoursRemaining);
  const isToday = day.day === 'today';

  return (
    <div
      className="icu-card-elevated"
      style={{
        padding: '12px 14px',
        borderLeft: `3px solid ${statusColor(day.sprint.status)}`,
        opacity: isToday ? 1 : 0.92,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--icu-text)',
          }}
        >
          {isToday ? 'Today' : 'Tomorrow'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>{day.date}</span>
        <span
          title={
            day.tsbSource === 'recorded'
              ? 'From your wellness record for today'
              : day.tsbSource === 'projected'
              ? 'Projected by Intervals.icu from workouts already on your calendar'
              : 'Modelled assuming you do not train today'
          }
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: '2px 6px',
            borderRadius: 4,
            color: day.provisional ? 'var(--icu-text-disabled)' : 'var(--icu-primary)',
            border: `1px solid ${day.provisional ? 'var(--icu-border)' : 'var(--icu-primary)'}`,
          }}
        >
          {SOURCE_LABEL[day.tsbSource]}
        </span>
      </div>

      {/* Sprint */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
        <Zap size={13} style={{ color: statusColor(day.sprint.status), flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--icu-text)', lineHeight: 1.3 }}>
            {day.sprint.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>
            Sprint volume {day.sprint.totalSprintVolume}
          </div>
        </div>
      </div>

      {/* Strength */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
        <Dumbbell size={13} style={{ color: zoneColor(day.strengthBand.zone), flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12, color: 'var(--icu-text)' }}>
            <span style={{ color: zoneColor(day.strengthBand.zone), fontWeight: 700 }}>
              {day.strengthBand.label}
            </span>
            {' — '}
            {day.strength.exercises[0]?.name}
            {day.strength.exercises.length > 1 ? ` +${day.strength.exercises.length - 1} more` : ''}
          </div>
          <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>
            TSB {day.tsb > 0 ? '+' : ''}{day.tsb.toFixed(1)} · {day.strengthBand.range}
          </div>
        </div>
      </div>

      {day.caveat && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--icu-orange)',
            background: 'rgba(255,152,0,0.08)',
            border: '1px solid rgba(255,152,0,0.2)',
            borderRadius: 5,
            padding: '5px 7px',
            margin: '0 0 6px',
            lineHeight: 1.45,
          }}
        >
          {day.caveat}
        </div>
      )}

      {/* Recovery window */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={12} style={{ color: 'var(--icu-text-disabled)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: day.recovery.cleared ? 'var(--icu-green)' : 'var(--icu-text-disabled)' }}>
          {day.recovery.cleared
            ? 'Max effort available'
            : `Max effort ${remaining ?? 'shortly'} (${Math.round(day.recovery.windowHours)}h window)`}
        </span>
      </div>
    </div>
  );
};

/**
 * §3.5 — Today and tomorrow at a glance.
 *
 * The dashboard otherwise prescribes only today, which leaves the athlete
 * unable to see what today's session costs them tomorrow. Tomorrow's fatigue is
 * Intervals.icu's own forecast where one exists; its sprint status is derived
 * from the recovery window rather than a guessed NFI, and is labelled as
 * provisional because tomorrow's velocity has not been measured yet.
 */
export const TwoDayPlanPanel: React.FC<TwoDayPlanPanelProps> = ({ plan }) => (
  <div className="icu-card" style={{ marginTop: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <CalendarClock size={16} style={{ color: 'var(--icu-primary)' }} />
      <span className="icu-section-title" style={{ marginBottom: 0 }}>Next 48 Hours</span>
      <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)', marginLeft: 'auto' }}>
        Recovery-window aware · Age-adjusted
      </span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
      <DayCard day={plan.today} />
      <DayCard day={plan.tomorrow} />
    </div>

    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--icu-text-disabled)', lineHeight: 1.5 }}>
      {plan.tomorrowBasis}
    </div>
  </div>
);

export default TwoDayPlanPanel;
