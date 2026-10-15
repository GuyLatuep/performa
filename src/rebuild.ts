import { api, DayActivity, DayEvidence, WorklogEntry } from "./api";
import { Draft } from "./drafts";
import { atMidnight, toDateInput, toTimeInput, today } from "./time";
import { ActiveTimer } from "./timer";

/**
 * Rebuilding a day: what the user did on it, next to what they booked, so the
 * gaps show. Evidence only — the app never fills a gap on its own; every
 * booking made from here goes through the ordinary log form.
 */

/** How far back a day can be rebuilt: the current month and the one before,
 *  the stretch the month view covers. Older history is the Jira site's to
 *  search, not this view's. */
export function canRebuild(date: string, now: string = today()): boolean {
  if (date > now) return false;
  const [y, m] = now.split("-").map(Number);
  const firstOfPrevious = toDateInput(new Date(y, m - 2, 1));
  return date >= firstOfPrevious;
}

// Per past day, for the session: what a day that is over holds in Jira hardly
// moves, and opening it twice should not cost the searches twice. Today is
// still happening, so it is read afresh every time. The cache belongs to one
// account and is dropped when the account changes — see `useAccountWatchers`.
const cache = new Map<string, Promise<DayActivity>>();

export function loadDayActivity(date: string): Promise<DayActivity> {
  if (date >= today()) return api.dayActivity(date);
  let hit = cache.get(date);
  if (!hit) {
    hit = api.dayActivity(date);
    // A failure is not worth keeping: the next open should try again.
    hit.catch(() => cache.delete(date));
    cache.set(date, hit);
  }
  return hit;
}

/** Drop every remembered day — on an account change, and for tests. */
export function forgetDayActivity(): void {
  cache.clear();
}

export type TimelineItem =
  | { kind: "worklog"; at: string; entry: WorklogEntry }
  | {
      kind: "evidence";
      at: string;
      evidence: DayEvidence;
      /** Time is already booked on this issue that day. */
      logged: boolean;
    }
  | {
      kind: "timer";
      at: string;
      seconds: number;
      issueKey: string | null;
      summary: string;
    }
  | { kind: "draft"; at: string; draft: Draft };

/**
 * The day in time order: worklogs, Jira evidence, the running timer's
 * stretches and parked drafts. An issue counts as logged when any worklog that
 * day is on it — a day-level view, so the question is "was this booked at
 * all", not "was it booked at that hour".
 */
export function dayTimeline(
  date: string,
  {
    evidence,
    worklogs,
    timer,
    drafts,
    now = Date.now(),
  }: {
    evidence: DayEvidence[];
    worklogs: WorklogEntry[];
    timer: ActiveTimer | null;
    drafts: Draft[];
    now?: number;
  },
): TimelineItem[] {
  const dayLogs = worklogs.filter((w) => w.date === date);
  const loggedKeys = new Set(dayLogs.map((w) => w.issueKey));
  const items: TimelineItem[] = [
    ...dayLogs.map((entry) => ({
      kind: "worklog" as const,
      at: entry.time,
      entry,
    })),
    ...evidence.map((e) => ({
      kind: "evidence" as const,
      at: toTimeInput(new Date(e.at)),
      evidence: e,
      logged: loggedKeys.has(e.issueKey),
    })),
    ...drafts
      .filter((d) => d.date === date)
      .map((draft) => ({ kind: "draft" as const, at: draft.time, draft })),
  ];
  if (timer) {
    // Only the part of each stretch inside the day: one that ran past
    // midnight counts on both days, each its own share.
    const dayStart = atMidnight(date).getTime();
    const next = atMidnight(date);
    next.setDate(next.getDate() + 1);
    const dayEnd = next.getTime();
    for (const s of timer.segments) {
      const start = Math.max(s.from, dayStart);
      const end = Math.min(s.to ?? now, dayEnd);
      if (end <= start) continue;
      items.push({
        kind: "timer",
        at: toTimeInput(new Date(start)),
        seconds: Math.round((end - start) / 1000),
        issueKey: timer.issueKey,
        summary: timer.issueSummary,
      });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
