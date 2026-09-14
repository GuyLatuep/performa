/** Seconds in each unit a Jira-style duration can name. */
const UNIT_SECONDS: Record<string, number> = {
  w: 5 * 8 * 3600, // Jira default working week
  d: 8 * 3600, // Jira default working day
  h: 3600,
  m: 60,
};

/** Parse a Jira-style duration ("1h 30m", "45m", "2h", "1.5h") into seconds.
 *  Decimal commas ("0,25h") are accepted as well.
 *  Returns null if nothing parseable is found. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/,/g, ".");
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([wdhm])/g)];
  const seconds = parts.length
    ? parts.reduce(
        (sum, [, amount, unit]) =>
          sum + parseFloat(amount) * UNIT_SECONDS[unit],
        0,
      )
    : // Bare number ⇒ interpret as hours.
      parseFloat(text) * 3600;
  return seconds > 0 ? Math.round(seconds) : null;
}

/** Format seconds as a compact "1h 30m" string. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  // Round to whole minutes first, then split — rounding the remainder
  // independently would turn 3,590s into "60m" instead of "1h".
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

/** Local date as yyyy-MM-dd. */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function today(): string {
  return toDateInput(new Date());
}

/** Local time-of-day as HH:mm. */
export function toTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function nowTime(): string {
  return toTimeInput(new Date());
}

/** yyyy-MM-dd for the Monday of the week containing `date`. */
export function startOfWeek(date: Date): string {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // Monday = 0
  return toDateInput(monday);
}

/** The local Date at midnight of a yyyy-MM-dd. The `T00:00:00` is what makes
 *  it local: a bare "yyyy-MM-dd" is read as UTC and lands on the day before
 *  everywhere west of Greenwich. */
export function atMidnight(date: string): Date {
  return new Date(date + "T00:00:00");
}

/** Human-readable label for a yyyy-MM-dd date, suffixed with "· Today" when
 *  it is the current day. `options` picks the shape — callers differ on how
 *  much detail their context needs. */
export function formatDayLabel(
  date: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const label = atMidnight(date).toLocaleDateString(undefined, options);
  return date === today() ? `${label} · Today` : label;
}

/** Compact relative age of an RFC3339 timestamp: "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Monday–Sunday (yyyy-MM-dd) of the week `offsetWeeks` from the current one. */
export function weekRange(offsetWeeks: number): { start: string; end: string } {
  const now = new Date();
  now.setDate(now.getDate() + offsetWeeks * 7);
  const start = startOfWeek(now);
  const endDate = atMidnight(start);
  endDate.setDate(endDate.getDate() + 6);
  return { start, end: toDateInput(endDate) };
}

/** First and last day (yyyy-MM-dd) of the month `offsetMonths` from the
 *  current one — the month view's range.
 *
 *  Built from the first of the month rather than by shifting today's date:
 *  moving 31 March back a month has nowhere to land and JavaScript rolls it
 *  forward into March again. */
export function monthRange(offsetMonths: number): {
  start: string;
  end: string;
} {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  // Day 0 of the next month is the last day of this one, whichever length it
  // has and whether or not February is leap.
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { start: toDateInput(first), end: toDateInput(last) };
}

/** Every date from `start` to `end`, both included.
 *
 *  Steps with `setDate`, which knows about the two 23- and 25-hour days a year:
 *  adding 86_400_000 milliseconds instead would drift across a DST boundary and
 *  hand back a month of 30 or 32 days. */
export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = atMidnight(start);
  const stop = atMidnight(end);
  while (cursor <= stop) {
    dates.push(toDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** Saturday or Sunday. */
export function isWeekend(date: string): boolean {
  const day = atMidnight(date).getDay();
  return day === 0 || day === 6;
}

/** "August 2026" — the month view's heading. */
export function monthLabel(start: string): string {
  return atMidnight(start).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/**
 * Monday-aligned week windows that together cover `start`–`end`.
 *
 * A month is fetched as its weeks rather than in one go, so it reuses the
 * per-week reads the timesheet and the start tab already have cached, and so
 * no single query approaches the backend's 100-issue search page. The first
 * and last window overrun the month at either end; callers filter what comes
 * back to the range they asked about.
 */
export function weekChunks(
  start: string,
  end: string,
): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  const cursor = atMidnight(startOfWeek(atMidnight(start)));
  const stop = atMidnight(end);
  while (cursor <= stop) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(cursor.getDate() + 6);
    chunks.push({ start: toDateInput(cursor), end: toDateInput(chunkEnd) });
    cursor.setDate(cursor.getDate() + 7);
  }
  return chunks;
}
