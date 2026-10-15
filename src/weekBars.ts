import { WorklogEntry } from "./api";
import { atMidnight, isWeekend, toDateInput } from "./time";
import { DayInfo } from "./workdays";

// The arithmetic behind the week chart: seven days bucketed from a week's
// worklogs, each against its own Daily target, and summed into the progress
// ring's fraction against the week's.
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
  /** What the day is expected to hold, and why. */
  info: DayInfo;
}

export interface WeekBars {
  /** The days to draw, weekends dropped unless they carry time. */
  days: DayBar[];
  /** What a full-height bar means — the highest target, or the longest day if
   *  that overshoots it. Never zero, so dividing by it is always safe. */
  scaleMax: number;
  /** The seven days' targets together: Holidays and Absences already off. */
  weekTarget: number;
  /** Every day's time, weekends included whether or not they are shown: the
   *  ring is about the week, not about the visible columns. */
  total: number;
  /** `total` against the weekly target. Unbounded on purpose — the ring clamps
   *  it for drawing, but the percentage beside it may read over 100. */
  pct: number;
}

/** Bucket one week's worklogs into per-day columns. `start` is the week's
 *  Monday (yyyy-MM-dd); `dayOf` says what each date is expected to hold. */
export function weekBars(
  start: string,
  entries: WorklogEntry[],
  {
    dayOf,
    showWeekends,
  }: { dayOf: (date: string) => DayInfo; showWeekends: boolean },
): WeekBars {
  const monday = atMidnight(start);
  const allDays: DayBar[] = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    const date = toDateInput(day);
    return {
      date,
      label: day.toLocaleDateString(undefined, { weekday: "short" }),
      seconds: 0,
      info: dayOf(date),
    };
  });

  const byDate = new Map(allDays.map((day) => [day.date, day]));
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (day) day.seconds += entry.timeSpentSeconds;
  }

  // Weekends are hidden by default, but a weekend day with logged time is
  // always shown so no bar silently disappears.
  // A Saturday someone is expected to work counts as shown, too.
  const days = allDays.filter(
    (day) =>
      !isWeekend(day.date) ||
      showWeekends ||
      day.seconds > 0 ||
      day.info.target > 0,
  );

  const weekTarget = allDays.reduce((sum, day) => sum + day.info.target, 0);
  const total = allDays.reduce((sum, day) => sum + day.seconds, 0);

  return {
    days,
    // The 1 is a floor, not a fallback: with no target and no time logged,
    // every height divides by this.
    scaleMax: Math.max(
      ...days.map((day) => Math.max(day.info.target, day.seconds)),
      1,
    ),
    weekTarget,
    total,
    pct: weekTarget > 0 ? total / weekTarget : 0,
  };
}
