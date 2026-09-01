import { WorklogEntry } from "./api";
import { eachDate, isWeekend, today } from "./time";

// A month of worklogs as a matrix: issues down the side, days across the top.
//
// Kept apart from the component that draws it because the interesting part is
// the arithmetic — which days get a column, which issues get a row, and what
// the three sets of totals add up to — and none of it needs React to be true.

export interface MonthColumn {
  date: string;
  weekend: boolean;
  isToday: boolean;
  /** Later than today. Nothing can be booked there, so the cell is inert. */
  future: boolean;
}

/** One issue's time on one day. Several worklogs can land here — the same
 *  issue picked up twice in a day — which is why this is a list and not a
 *  number: a cell holding more than one is never edited by guessing. */
export interface MonthCell {
  entries: WorklogEntry[];
  seconds: number;
}

export interface MonthRow {
  issueKey: string;
  issueSummary: string;
  /** Keyed by date. A day with nothing booked has no entry. */
  cells: Map<string, MonthCell>;
  total: number;
}

export interface MonthGrid {
  columns: MonthColumn[];
  rows: MonthRow[];
  dayTotals: Map<string, number>;
  total: number;
}

/**
 * The days the month gets a column for: every weekday, plus any weekend day
 * something was actually booked on.
 *
 * Saturdays and Sundays are left out by default because a month of them is
 * eight dead columns in a table that is already too wide — but leaving out a
 * weekend day somebody *worked* would hide their time, so a booking earns the
 * column back.
 */
export function monthColumns(
  start: string,
  end: string,
  booked: Iterable<string>,
): MonthColumn[] {
  const bookedDates = new Set(booked);
  const now = today();
  return eachDate(start, end)
    .filter((date) => !isWeekend(date) || bookedDates.has(date))
    .map((date) => ({
      date,
      weekend: isWeekend(date),
      isToday: date === now,
      future: date > now,
    }));
}

/**
 * The matrix for one month.
 *
 * `rowOrder` fixes which issue sits in which row. Without it the rows are
 * ordered by their month total, and an edit that changes a total reorders the
 * table *while it is being typed into* — the row under the cursor moves out
 * from under it. Callers compute the order once per load (see `rowOrderOf`)
 * and hand the same one back for every re-derivation in between; issues it
 * doesn't mention keep their natural place at the end.
 *
 * Entries outside `start`–`end` are ignored, so a caller can pass whatever the
 * week-sized fetches came back with and let the month decide what belongs.
 */
export function buildMonthGrid(
  entries: WorklogEntry[],
  start: string,
  end: string,
  rowOrder?: string[],
): MonthGrid {
  const inRange = entries.filter((e) => e.date >= start && e.date <= end);
  const columns = monthColumns(
    start,
    end,
    inRange.filter((e) => isWeekend(e.date)).map((e) => e.date),
  );
  // Only days that got a column count towards a total: a weekend booking is
  // always shown (it earned its column above), so nothing is silently dropped
  // here — this only guards against a total nobody can see the source of.
  const shown = new Set(columns.map((c) => c.date));

  const rows = new Map<string, MonthRow>();
  const dayTotals = new Map<string, number>();
  let total = 0;

  for (const entry of inRange) {
    if (!shown.has(entry.date)) continue;
    const row = rows.get(entry.issueKey) ?? {
      issueKey: entry.issueKey,
      // Jira can return a different summary per worklog fetch if the issue was
      // renamed mid-month; the first one wins, which is the older of the two.
      issueSummary: entry.issueSummary,
      cells: new Map<string, MonthCell>(),
      total: 0,
    };
    const cell = row.cells.get(entry.date) ?? { entries: [], seconds: 0 };
    cell.entries.push(entry);
    cell.seconds += entry.timeSpentSeconds;
    row.cells.set(entry.date, cell);
    row.total += entry.timeSpentSeconds;
    rows.set(entry.issueKey, row);

    dayTotals.set(
      entry.date,
      (dayTotals.get(entry.date) ?? 0) + entry.timeSpentSeconds,
    );
    total += entry.timeSpentSeconds;
  }

  return {
    columns,
    rows: orderRows([...rows.values()], rowOrder),
    dayTotals,
    total,
  };
}

/** The order to pin: the issues with the most time on top, and issue key as a
 *  tiebreak so two rows that add up the same don't swap places at random. */
export function rowOrderOf(grid: MonthGrid): string[] {
  return grid.rows.map((r) => r.issueKey);
}

/** Rows in `pinned` order, with anything the pin doesn't know about — an issue
 *  first booked since the order was taken — sorted onto the end. */
function orderRows(rows: MonthRow[], pinned?: string[]): MonthRow[] {
  const byTotal = [...rows].sort(
    (a, b) => b.total - a.total || a.issueKey.localeCompare(b.issueKey),
  );
  if (!pinned) return byTotal;
  const rank = new Map(pinned.map((key, i) => [key, i]));
  // Unpinned rows rank after every pinned one — `pinned.length`, not Infinity,
  // because two of them would subtract to NaN and leave the sort undefined —
  // and a stable sort keeps them in the by-total order they arrived in.
  const rankOf = (row: MonthRow) => rank.get(row.issueKey) ?? pinned.length;
  return byTotal.sort((a, b) => rankOf(a) - rankOf(b));
}
