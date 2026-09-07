import React from 'react';
import { Activity, AlertTriangle, ArrowLeft, RefreshCw, Zap } from 'lucide-react';
import { PaceCurvePanel } from './PaceCurvePanel';
import type { DistanceEdit, PaceCurveActivityStream } from '../domain/sprint/pace-curve';
import { paceCurveNotice } from '../application/pace-curve-sync';
import type { PaceCurveCoverage } from '../application/dashboard-sync';

export interface PaceCurveScreenProps {
  /** The streams the deferred load fetched. Empty until it resolves. */
  streams: PaceCurveActivityStream[];
  /** Distances the athlete has chosen, ascending. */
  distances: number[];
  /** The athlete's 60-day peak velocity, for the account-specific outlier bound. */
  bestVmax60d: number;
  /** How much of the eligible history the streams cover. Omitted in demo mode. */
  coverage?: PaceCurveCoverage;
  status: 'loading' | 'ready' | 'error';
  /** The failure text, when `status` is `error`. */
  errorMessage?: string | null;
  /** True when Intervals.icu refused at least one request for this load. */
  rateLimited?: boolean;
  /** Re-run the load. Omitted in demo mode, where there is nothing to retry. */
  onRetry?: () => void;
  /** Back to the dashboard. */
  onBack: () => void;
  /** Toggle a preset chip. Omitted in demo mode. */
  onToggleDistance?: (distance: number) => DistanceEdit;
  /** Add a custom distance. Omitted in demo mode. */
  onAddDistance?: (distance: number) => DistanceEdit;
  /** Sign in. Present only in demo mode. */
  onLogin?: () => void;
}

/**
 * The sprint pace curve, on its own screen.
 *
 * It used to sit at the bottom of a 1035-line single-scroll dashboard: the
 * densest analysis in the app and the hardest to reach. Giving it its own route
 * is not only navigation — it is what makes the streams it needs *deferrable*.
 * A dashboard load now issues zero `/streams` requests; opening this screen is
 * what pays for them, once, and the persistent cache means a second visit pays
 * nothing at all.
 *
 * The chart itself is unchanged: {@link PaceCurvePanel} still owns it, with the
 * same contract. What lives here is everything the panel could not say from
 * inside a dashboard that had already fetched its data — a loading state, a
 * stated error, and the difference between "rate-limited, this is a lower
 * bound" and "you have not sprinted in this window".
 */
export const PaceCurveScreen: React.FC<PaceCurveScreenProps> = ({
  streams,
  distances,
  bestVmax60d,
  coverage,
  status,
  errorMessage,
  rateLimited,
  onRetry,
  onBack,
  onToggleDistance,
  onAddDistance,
  onLogin,
}) => {
  // Only the transport states are decided here. Everything about a *complete*
  // load — a short read, an empty window — is the panel's own business, and
  // saying it twice would be worse than saying it once.
  const notice = paceCurveNotice({ status, errorMessage, rateLimited, coverage, measuredPoints: 1 });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--icu-bg)', color: 'var(--icu-text)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 16px',
          borderBottom: '1px solid var(--icu-border)',
          background: 'var(--icu-bg-elevated, rgba(255,255,255,0.02))',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="icu-btn-ghost"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px' }}
        >
          <ArrowLeft size={13} /> Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={15} style={{ color: 'var(--icu-primary)' }} />
          <h1 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Sprint Pace Curve</h1>
        </div>
        {onLogin && (
          <button
            type="button"
            onClick={onLogin}
            className="icu-btn"
            style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 12px' }}
          >
            Connect Intervals.icu
          </button>
        )}
      </header>

      {/* A single column, capped, so the chart stays readable on a wide screen
          and the readouts still wrap cleanly at 360 px. */}
      <main style={{ padding: 12, maxWidth: 760, margin: '0 auto' }}>
        {notice.kind === 'loading' && (
          <div className="icu-card" role="status" style={statusBoxStyle}>
            <Zap className="animate-pulse" size={28} style={{ color: 'var(--icu-primary)' }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>{notice.message}</div>
            <div style={{ fontSize: 11, color: 'var(--icu-text-disabled)', lineHeight: 1.6 }}>
              Up to 40 sessions, a few at a time. They are cached afterwards, so
              coming back here costs nothing.
            </div>
          </div>
        )}

        {notice.kind === 'error' && (
          <div className="icu-card" role="alert" style={statusBoxStyle}>
            <AlertTriangle size={28} style={{ color: 'var(--icu-red)' }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>{notice.message}</div>
            {onRetry && (
              <button type="button" onClick={onRetry} className="icu-btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} /> Try again
              </button>
            )}
          </div>
        )}

        {/* A rate-limited load still has a curve worth showing — it is simply a
            lower bound, and saying so is the whole point. */}
        {notice.kind === 'rate-limited' && (
          <div
            className="icu-card"
            role="status"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, borderColor: 'var(--icu-orange)' }}
          >
            <AlertTriangle size={14} style={{ color: 'var(--icu-orange)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 11, lineHeight: 1.6 }}>
              {notice.message}
              {onRetry && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={onRetry}
                    className="icu-btn-ghost"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {status !== 'loading' && status !== 'error' && (
          <PaceCurvePanel
            streams={streams}
            distances={distances}
            bestVmax60d={bestVmax60d}
            coverage={coverage}
            onToggleDistance={onToggleDistance}
            onAddDistance={onAddDistance}
          />
        )}
      </main>
    </div>
  );
};

const statusBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  padding: '40px 20px',
  textAlign: 'center',
};

export default PaceCurveScreen;
