export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type AthleteType = 'fascia' | 'muscle';
export type CNSDemand = 'high' | 'low' | 'rest';
export type MacroPhase = 'Accumulation' | 'Intensification' | 'Deload';
export type OIPhaseNumber = 1 | 2 | 3;

export interface PrimaryMovement {
  name: string;
  sets: number;
  repsOrDuration: string;
  notes?: string;
}

export interface FasciaDayPlan {
  week: 1 | 2 | 3 | 4;
  day: DayOfWeek;
  phaseName: MacroPhase;
  cnsDemand: CNSDemand;
  primaryMovements: PrimaryMovement[];
  exercises: string[];
  oiPhase: OIPhaseNumber;
  /** 1.0 = full, 0.55 = deload */
  volumeModifier: number;
}

type DayTemplate = {
  phaseName: MacroPhase;
  cnsDemand: CNSDemand;
  movements: PrimaryMovement[];
  exercises: string[];
};

const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * §4 — Fascia-Driven 4-Week Periodization
 *
 * Based on Joel Smith's Speed Strength philosophy:
 *  - Weeks 1–2: Accumulation (tendon loading / structural integrity)
 *  - Week 3:    Intensification (shift from building to utilising recoil)
 *  - Week 4:    Deload / Supercompensation (−40–50% volume, high intensity maintained)
 *
 * Weekly High-Low-High-Low-High pattern:
 *  Mon: Max Velocity & Reactive Power (High CNS)
 *  Tue: Extensive Plyometrics & Recovery (Low CNS)
 *  Wed: Acceleration & Oscillatory Strength (High CNS)
 *  Thu: Mobility & Active Recovery (Low CNS)
 *  Fri: Elastic Capacity & Specific Strength (High CNS)
 */
export class FasciaPeriodization {
  // ── Weeks 1–2: Accumulation ──────────────────────────────────────────────
  private static readonly ACCUM_TEMPLATES: Record<DayOfWeek, DayTemplate> = {
    Mon: {
      phaseName: 'Accumulation',
      cnsDemand: 'high',
      movements: [
        { name: '20m Fly Sprints (25m build-up)', sets: 5, repsOrDuration: '4–6 reps @ 95–100%' },
        { name: 'Depth Jumps (18–24" box)', sets: 3, repsOrDuration: '3×5', notes: 'Measure RSI each set' },
      ],
      exercises: [
        'Ankle bounce warm-up 3 min',
        'Hip 90-90 stretch 2×60s',
        'A-skip 3×20m as sprint activation',
      ],
    },
    Tue: {
      phaseName: 'Accumulation',
      cnsDemand: 'low',
      movements: [
        { name: 'Ankle Hops (stiff knee)', sets: 4, repsOrDuration: '4×10m' },
        { name: 'Trap Bar Deadlift (sub-maximal)', sets: 3, repsOrDuration: '3×3 @ 75% 1RM' },
      ],
      exercises: [
        'Banded clamshell 2×15',
        'Nordic curl eccentric 2×6',
        'Core anti-rotation 2×30s',
      ],
    },
    Wed: {
      phaseName: 'Accumulation',
      cnsDemand: 'high',
      movements: [
        { name: '10m Sled Sprints (10% bodyweight)', sets: 7, repsOrDuration: '6–8 reps' },
        { name: 'Yielding Isometrics — Split Squat', sets: 2, repsOrDuration: '2×2 min/leg', notes: 'OI Phase 1: catch-and-hold' },
      ],
      exercises: [
        'Foam roll ITB 5 min',
        'Hip flexor stretch 2×60s',
        'Diaphragm breathing 5 min post-session',
      ],
    },
    Thu: {
      phaseName: 'Accumulation',
      cnsDemand: 'low',
      movements: [
        { name: 'Hurdle Hop Series', sets: 4, repsOrDuration: '4×6 hurdles', notes: 'Focus on front-side mechanics' },
        { name: 'OI Split Squat Hold', sets: 3, repsOrDuration: '3×15s hold @ 70% effort' },
      ],
      exercises: [
        'A-skip 3×20m',
        'Ankle stiffness drill 3×30s',
        'Hip 90-90 mobility 2 min',
      ],
    },
    Fri: {
      phaseName: 'Accumulation',
      cnsDemand: 'high',
      movements: [
        { name: 'Ankle Hops (stiff knee)', sets: 4, repsOrDuration: '4×10m', notes: 'Maintain contact-time below 130ms' },
        { name: 'Trap Bar Deadlift (sub-maximal)', sets: 3, repsOrDuration: '3×3 @ 75% 1RM' },
      ],
      exercises: [
        'Supine breathing 5 min',
        'Calf soleus stretch 2×60s',
        'Single-leg calf raise 3×12 (cool-down)',
      ],
    },
  };

  // ── Week 3: Intensification ───────────────────────────────────────────────
  private static readonly INTENS_TEMPLATES: Record<DayOfWeek, DayTemplate> = {
    Mon: {
      phaseName: 'Intensification',
      cnsDemand: 'high',
      movements: [
        { name: 'Wicket Runs (6–8 hurdles)', sets: 3, repsOrDuration: '3×6 hurdles @ 95%', notes: 'Replace 20m Flys — focus on vertical force' },
        { name: 'Depth Jumps (18–24" box)', sets: 3, repsOrDuration: '3×4', notes: 'Measure RSI — benchmark vs weeks 1–2' },
      ],
      exercises: [
        'Sprint warm-up progressions 3×60m @ 60/75/90%',
        'Hip flexor activation drill 3 min',
        'A-run 3×20m',
      ],
    },
    Tue: {
      phaseName: 'Intensification',
      cnsDemand: 'high',
      movements: [
        { name: 'Trap Bar Deadlift', sets: 4, repsOrDuration: '4×3 @ 85%' },
        { name: 'Hang Power Clean', sets: 3, repsOrDuration: '3×3 @ 80%' },
      ],
      exercises: [
        'Post-strength depth jump 3×2 (potentiation)',
        'Core Pallof press 3×10',
        '90/90 breathing 5 min',
      ],
    },
    Wed: {
      phaseName: 'Intensification',
      cnsDemand: 'high',
      movements: [
        { name: 'Hill Sprints 15–20m', sets: 6, repsOrDuration: '6–8 reps', notes: 'Replace sled — incline forces better shin angles' },
        { name: 'Oscillatory Isometrics — Split Squat', sets: 3, repsOrDuration: '3×10s rapid pulses (1–2" range)', notes: 'OI Phase 2: rapid pulses' },
      ],
      exercises: [
        'Reactive ankle work 3×30s',
        '90-90 breathing 5 min',
      ],
    },
    Thu: {
      phaseName: 'Intensification',
      cnsDemand: 'low',
      movements: [
        { name: 'Speed-Endurance Runs', sets: 2, repsOrDuration: '2×150m @ 90%', notes: 'Walk-back recovery 6 min per rep' },
      ],
      exercises: [
        'Rolling leg swing 3 min',
        'Foam roll full-body 10 min',
        'Static hold circuit 10 min',
      ],
    },
    Fri: {
      phaseName: 'Intensification',
      cnsDemand: 'rest',
      movements: [
        { name: 'Active Recovery Walk', sets: 1, repsOrDuration: '20 min @ easy pace' },
        { name: 'Contrast Hydrotherapy', sets: 1, repsOrDuration: '4 cycles hot/cold', notes: 'Recommended after max-velocity week' },
      ],
      exercises: [
        'Foam roll full-body 10 min',
        'Static stretch circuit 15 min',
      ],
    },
  };

  // ── Week 4: Deload ────────────────────────────────────────────────────────
  private static readonly DELOAD_TEMPLATES: Record<DayOfWeek, DayTemplate> = {
    Mon: {
      phaseName: 'Deload',
      cnsDemand: 'low',
      movements: [
        { name: 'Short Acceleration', sets: 2, repsOrDuration: '2×20m @ 80–85%', notes: '−40–50% volume; stop 1–2 reps early' },
        { name: 'OI Reactive Switch', sets: 2, repsOrDuration: '2×10s oscillation after drop', notes: 'Phase 3: drop then oscillate' },
      ],
      exercises: [
        'Easy walk warm-up 10 min',
        'Hip 90-90 mobility 2 min',
      ],
    },
    Tue: {
      phaseName: 'Deload',
      cnsDemand: 'low',
      movements: [
        { name: 'Goblet Squat', sets: 2, repsOrDuration: '2×6 @ 60%' },
        { name: 'Glute Bridge', sets: 2, repsOrDuration: '2×10' },
      ],
      exercises: [
        'Banded hip distraction 2×60s',
        'Box breathing 5 min',
      ],
    },
    Wed: {
      phaseName: 'Deload',
      cnsDemand: 'rest',
      movements: [
        { name: 'Easy Walk', sets: 1, repsOrDuration: '15 min relaxed pace' },
        { name: 'RPR Breathing Drills', sets: 1, repsOrDuration: '10 min', notes: 'Reflexive Performance Reset' },
      ],
      exercises: [
        'Full-body foam roll 15 min',
        'Box breathing 5 min',
      ],
    },
    Thu: {
      phaseName: 'Deload',
      cnsDemand: 'low',
      movements: [
        { name: 'Box Step-Up', sets: 2, repsOrDuration: '2×5 @ 50%' },
        { name: 'Single-Leg Balance', sets: 2, repsOrDuration: '2×30s each side' },
      ],
      exercises: [
        'A-march 2×20m',
        'Ankle circles 2 min',
      ],
    },
    Fri: {
      phaseName: 'Deload',
      cnsDemand: 'rest',
      movements: [
        { name: 'Short Contrast Hydrotherapy', sets: 1, repsOrDuration: '3 cycles hot/cold', notes: 'Shorter than intensification protocol' },
        { name: 'Yoga / Mobility Flow', sets: 1, repsOrDuration: '20 min' },
      ],
      exercises: [
        'Box breathing 5 min',
        'Supine 90-90 stretch 5 min',
      ],
    },
  };

  private static templateForWeek(week: 1 | 2 | 3 | 4): Record<DayOfWeek, DayTemplate> {
    if (week <= 2) return FasciaPeriodization.ACCUM_TEMPLATES;
    if (week === 3) return FasciaPeriodization.INTENS_TEMPLATES;
    return FasciaPeriodization.DELOAD_TEMPLATES;
  }

  /**
   * Returns the OI progression phase for a given week.
   * weeks 1–2 → phase 1 (catch-and-hold)
   * week 3    → phase 2 (rapid-pulses)
   * week 4+   → phase 3 (reactive-switch)
   */
  static getOIPhase(week: number): OIPhaseNumber {
    if (week <= 2) return 1;
    if (week === 3) return 2;
    return 3;
  }

  /**
   * Returns the single-day plan for a given week + day combination.
   * For fascia athletes OI sets are boosted by +1.
   * For muscle athletes OI-type movements have reduced duration (−30%).
   */
  static getDayPlan(week: 1 | 2 | 3 | 4, dayOfWeek: DayOfWeek): FasciaDayPlan {
    return FasciaPeriodization.generateWeeklyPlan(week, 'fascia').find(d => d.day === dayOfWeek)!;
  }

  /**
   * Returns all 5 training days for a given week.
   * Fascia athletes: +1 set on OI movements.
   * Muscle athletes: OI movements' sets reduced by 1 (min 1), plain strength swapped in.
   * Week 4 deload: sets multiplied by volumeModifier (0.55 → effectively −45%).
   */
  static generateWeeklyPlan(week: 1 | 2 | 3 | 4, athleteType: AthleteType): FasciaDayPlan[] {
    const templates = FasciaPeriodization.templateForWeek(week);
    const volumeModifier: number = week === 4 ? 0.55 : 1.0;
    const oiPhase = FasciaPeriodization.getOIPhase(week);

    return DAYS.map(day => {
      const tmpl = templates[day];
      const movements: PrimaryMovement[] = tmpl.movements.map(m => {
        let sets = m.sets;

        const isOI = m.name.toLowerCase().includes('isometric') ||
                     m.name.toLowerCase().includes('oi ') ||
                     m.name.toLowerCase().includes('oscillatory');

        if (isOI) {
          sets = athleteType === 'fascia' ? sets + 1 : Math.max(1, sets - 1);
        }

        // Apply deload volume modifier (round to nearest whole set, min 1)
        sets = Math.max(1, Math.round(sets * volumeModifier));

        return { ...m, sets };
      });

      return {
        week,
        day,
        phaseName: tmpl.phaseName,
        cnsDemand: tmpl.cnsDemand,
        primaryMovements: movements,
        exercises: [...tmpl.exercises],
        oiPhase,
        volumeModifier,
      };
    });
  }
}
