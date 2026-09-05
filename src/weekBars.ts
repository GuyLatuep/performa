import { WorklogEntry } from "./api";
import { WORKDAYS_PER_WEEK } from "./settings";
import { toDateInput } from "./time";

// The arithmetic behind the week chart: seven days bucketed from a week's
// worklogs, scaled against the daily target, and summed into the progress
// ring's fraction.
//
// Split from the component for the reason `monthGrid` is: none of it is about
// rendering, and the edge cases that matter — a weekend day that has time on
// it, a bar taller than the target, a zero target — are far easier to state as
// a table than to reach through the DOM.

/** One day's column. */
export interface DayBar {
  /** yyyy-MM-dd. */
  date: string;
  /** Weekday name in the current locale ("Mon"). */
  label: string;
  seconds: number;
}

export interface WeekBars {
  /** The days to draw, weekends dropped unless they carry time. */
  days: DayBar[];
  /** What a full-height bar means — the target, or the longest day if that
   *  overshoots it. Never zero, so dividing by it is always safe. */
  scaleMax: number;
  /** Every day's time, weekends included whether or not they are shown: the
   *  ring is about the week, not about the visible columns. */
  total: number;
  /** `total` against the weekly target. Unbounded on purpose — the ring clamps
   *  it for drawing, but the percentage beside it may read over 100. */
  pct: number;
}

/**
 * Bucket one week's worklogs into per-day columns.
 *
 * `start` is the week's Monday (yyyy-MM-dd), parsed as *local* midnight — a
 * bare date string would be read as UTC and shift the whole week west of
 * Greenwich.
 */
export function weekBars(
  start: string,
  entries: WorklogEntry[],
  { dayTarget, showWeekends }: { dayTarget: number; showWeekends: boolean },
): WeekBars {
  const startDate = new Date(start + "T00:00:00");
  const allDays: DayBar[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return {
      date: toDateInput(d),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      seconds: 0,
    };
  });

  const byDate = new Map(allDays.map((d) => [d.date, d]));
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (day) day.seconds += entry.timeSpentSeconds;
  }

  // Weekends are hidden by default, but a weekend day with logged time is
  // always shown so no bar silently disappears.
  const days = allDays.filter(
    (d, i) => i < WORKDAYS_PER_WEEK || showWeekends || d.seconds > 0,
  );

  const weekTarget = dayTarget * WORKDAYS_PER_WEEK;
  const total = allDays.reduce((sum, d) => sum + d.seconds, 0);

  return {
    days,
    // The 1 is a floor, not a fallback: with no target and no time logged,
    // every height divides by this.
    scaleMax: Math.max(dayTarget, ...days.map((d) => d.seconds), 1),
    total,
    pct: weekTarget > 0 ? total / weekTarget : 0,
  };
}
