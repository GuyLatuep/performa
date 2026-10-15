import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { logDebug, logInfo } from "./log";
import { persisted } from "./persist";
import { createStore } from "./store";
import { addDraft } from "./drafts";
import { toDateInput, toTimeInput } from "./time";

/** One stretch of running time. `to` is null while it is still running. */
export interface TimerSegment {
  from: number; // epoch ms
  to: number | null; // epoch ms
}

export interface ActiveTimer {
  /** Null for a timer started before its ticket exists. Stopping one of those
   *  parks its time as a draft, with the summary as the note. */
  issueKey: string | null;
  /** The issue's summary — or, with no issue, the note it was started with. */
  issueSummary: string;
  /** Oldest first. Only the last one may be open; when none is, the timer is
   *  paused. Never empty. */
  segments: TimerSegment[];
}

const STORAGE_KEY = "performa-active-timer";

const isTime = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function parseSegments(raw: unknown): TimerSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const segments: TimerSegment[] = [];
  for (const [i, seg] of raw.entries()) {
    const { from, to } = (seg ?? {}) as { from?: unknown; to?: unknown };
    if (!isTime(from)) return null;
    // An open stretch anywhere but last would be two clocks running at once.
    if (to === null && i === raw.length - 1) segments.push({ from, to: null });
    else if (isTime(to)) segments.push({ from, to });
    else return null;
  }
  return segments;
}

// Persisted as stretches of wall-clock time, so elapsed is computed from the
// clock and stays correct even if the app was closed while a timer was
// running. Timers stored before pausing existed carry a bare `startedAt`:
// that reads as one stretch still running, so an update never loses one.
const store = persisted<ActiveTimer | null>(STORAGE_KEY, (stored) => {
  const t = stored as
    | {
        issueKey?: unknown;
        issueSummary?: unknown;
        segments?: unknown;
        startedAt?: unknown;
      }
    | null
    | undefined;
  if (!t || (typeof t.issueKey !== "string" && t.issueKey !== null))
    return null;
  const segments =
    t.segments !== undefined
      ? parseSegments(t.segments)
      : isTime(t.startedAt)
        ? [{ from: t.startedAt, to: null }]
        : null;
  if (!segments) return null;
  const issueSummary = typeof t.issueSummary === "string" ? t.issueSummary : "";
  return { issueKey: t.issueKey, issueSummary, segments };
});

/** When the work began: the start of the first stretch. This, not the latest
 *  resume, is the start time a worklog for the timer carries. */
export function timerStartedAt(timer: ActiveTimer): number {
  return timer.segments[0].from;
}

export function isPaused(timer: ActiveTimer): boolean {
  return timer.segments[timer.segments.length - 1].to !== null;
}

/** Milliseconds banked in the stretches that have already ended. */
function closedMs(timer: ActiveTimer): number {
  return timer.segments.reduce(
    (sum, s) => sum + (s.to === null ? 0 : Math.max(0, s.to - s.from)),
    0,
  );
}

/** The instant a clock started from zero would have to have begun at to read
 *  the timer's elapsed time now, or null while paused (the clock stands
 *  still). Lets a running timer tick exactly like one that was never paused —
 *  here and in the tray alike. */
export function clockOrigin(timer: ActiveTimer): number | null {
  const open = timer.segments[timer.segments.length - 1];
  return open.to === null ? open.from - closedMs(timer) : null;
}

/** Whole seconds of running time, paused stretches left out. */
export function elapsedSeconds(timer: ActiveTimer, now: number): number {
  const origin = clockOrigin(timer);
  const ms = origin === null ? closedMs(timer) : now - origin;
  return Math.max(0, Math.floor(ms / 1000));
}

/** Mirror the timer to the Rust side so the system tray can display it. */
function syncTray(timer: ActiveTimer | null): void {
  let call: Promise<unknown>;
  if (!timer) {
    call = invoke("timer_stopped");
  } else {
    const origin = clockOrigin(timer);
    call =
      origin === null
        ? invoke("timer_paused", {
            issueKey: timer.issueKey,
            elapsedSeconds: elapsedSeconds(timer, Date.now()),
          })
        : invoke("timer_started", {
            issueKey: timer.issueKey,
            startedAt: origin,
          });
  }
  // The tray is cosmetic — never let it break timing.
  call.catch((err) => logDebug(`tray sync failed: ${err}`));
}

// A timer restored from a previous run must reappear in the tray too.
if (store.get()) {
  syncTray(store.get());
}

function save(timer: ActiveTimer | null): void {
  store.save(timer);
  syncTray(timer);
}

export function getTimer(): ActiveTimer | null {
  return store.get();
}

export function startTimer(
  issueKey: string | null,
  issueSummary: string,
): void {
  save({ issueKey, issueSummary, segments: [{ from: Date.now(), to: null }] });
  logInfo(`timer started on ${issueKey ?? "no ticket"}`);
  // Without a ticket there is nothing to move, and nothing else may be moved
  // in its place.
  if (!issueKey) return;
  // Best-effort nudge to "In Arbeit" — must never block or fail the timer.
  // Only on a genuine start, not when a persisted timer is restored on launch.
  // api.startIssueWork already logs its own outcome (incl. failures); nothing
  // more to do here than stop it from becoming an unhandled rejection.
  api.startIssueWork(issueKey).catch(() => {});
}

/** Stop the clock without ending the timer. No-op unless one is running. */
export function pauseTimer(): void {
  const timer = store.get();
  if (!timer || isPaused(timer)) return;
  const now = Date.now();
  const segments = timer.segments.map((s) =>
    s.to === null ? { from: s.from, to: Math.max(s.from, now) } : s,
  );
  save({ ...timer, segments });
  logInfo(`timer paused on ${timer.issueKey}`);
}

/** Start the clock again where it stood. No-op unless one is paused. */
export function resumeTimer(): void {
  const timer = store.get();
  if (!timer || !isPaused(timer)) return;
  save({
    ...timer,
    segments: [...timer.segments, { from: Date.now(), to: null }],
  });
  logInfo(`timer resumed on ${timer.issueKey}`);
}

/** A timer taken off the clock whose time has yet to be logged or discarded,
 *  with its running time already rounded up for the log form. */
export interface StoppedTimer {
  timer: ActiveTimer;
  seconds: number;
}

// Oldest first. In memory only, like the log form it feeds: the form allows no
// way out but logging or a confirmed discard, so nothing in here is ever
// dropped silently. A queue rather than one slot so a switch made while an
// earlier form is still open cannot push that earlier time out.
const toLog = createStore<StoppedTimer[]>([]);

/** Take the timer off the clock and queue its time for the log form. A timer
 *  with no issue has nowhere to log to, so its time is parked as a draft
 *  straight away instead. */
export function stopForLogging(): void {
  const timer = store.get();
  if (!timer) return;
  const seconds = roundUpToQuarterHour(elapsedSeconds(timer, Date.now()));
  stopTimer();
  if (timer.issueKey === null) parkStopped({ timer, seconds });
  else toLog.set([...toLog.get(), { timer, seconds }]);
}

/** Park a stopped timer's time as a draft rather than logging it now — the
 *  log form's "Later". */
export function parkStopped({ timer, seconds }: StoppedTimer): void {
  const started = new Date(timerStartedAt(timer));
  addDraft({
    seconds,
    date: toDateInput(started),
    time: toTimeInput(started),
    note:
      timer.issueKey === null
        ? timer.issueSummary || "Timer without a ticket"
        : "",
    issueKey: timer.issueKey,
    issueSummary: timer.issueKey === null ? "" : timer.issueSummary,
    billable: true,
  });
}

/** Start timing `issueKey`, handing any timer already there — running or
 *  paused — to the log form rather than refusing. The new clock starts at
 *  once, so filling in the old one's form costs the new one nothing. */
export function switchTimer(
  issueKey: string | null,
  issueSummary: string,
): void {
  const current = store.get();
  // Already timing that issue. Two ticket-less timers are two different
  // pieces of work, though, so a second one does switch.
  if (current && issueKey !== null && current.issueKey === issueKey) return;
  if (current) {
    logInfo(
      `timer switched from ${current.issueKey ?? "no ticket"} to ${issueKey ?? "no ticket"}`,
    );
    stopForLogging();
  }
  startTimer(issueKey, issueSummary);
}

/**
 * The stretches with `[from, to)` taken out of them.
 *
 * A stretch straddling the cut becomes the part before it and the part after;
 * a still-running stretch keeps running after the cut. Never empty: cutting
 * away everything leaves a zero-length stretch at the start, so the timer
 * still knows when the work began.
 */
export function removeInterval(
  segments: TimerSegment[],
  from: number,
  to: number,
): TimerSegment[] {
  const out: TimerSegment[] = [];
  for (const s of segments) {
    const end = s.to ?? Infinity;
    if (end <= from || s.from >= to) {
      out.push(s);
      continue;
    }
    if (s.from < from) out.push({ from: s.from, to: from });
    if (end > to) out.push({ from: to, to: s.to });
  }
  return out.length > 0
    ? out
    : [{ from: segments[0].from, to: segments[0].from }];
}

/** Running milliseconds inside `[from, to)` — how much of an away stretch the
 *  timer actually counted. Paused stretches count nothing. */
export function runningMsWithin(
  timer: ActiveTimer,
  from: number,
  to: number,
): number {
  return timer.segments.reduce((sum, s) => {
    const start = Math.max(s.from, from);
    const end = Math.min(s.to ?? to, to);
    return sum + Math.max(0, end - start);
  }, 0);
}

/** Idle time, answered "not work": cut the away stretch out, keep running. */
export function discardAway(from: number, to: number): void {
  const timer = store.get();
  if (!timer) return;
  save({ ...timer, segments: removeInterval(timer.segments, from, to) });
  logInfo(`timer: dropped ${Math.round((to - from) / 60_000)} idle minutes`);
}

/** Idle time, answered "decide later": cut it out and park what the timer
 *  had counted of it as a draft on the same issue. */
export function parkAway(from: number, to: number): void {
  const timer = store.get();
  if (!timer) return;
  const ms = runningMsWithin(timer, from, to);
  discardAway(from, to);
  if (ms < 60_000) return;
  const start = new Date(from);
  const end = new Date(to);
  addDraft({
    seconds: Math.round(ms / 1000),
    date: toDateInput(start),
    time: toTimeInput(start),
    note: `Away from the timer, ${toTimeInput(start)}–${toTimeInput(end)}`,
    issueKey: timer.issueKey,
    issueSummary: timer.issueKey === null ? "" : timer.issueSummary,
    billable: true,
  });
}

/** Idle time, answered "I was done": the timer ends where the user left, and
 *  the log form opens with only the time before that. */
export function stopAtAway(from: number): void {
  const timer = store.get();
  if (!timer) return;
  save({ ...timer, segments: removeInterval(timer.segments, from, Infinity) });
  stopForLogging();
}

/** The stopped timers waiting on the log form, oldest first. */
export function getTimersToLog(): StoppedTimer[] {
  return toLog.get();
}

export function useTimersToLog(): StoppedTimer[] {
  return toLog.use();
}

/** The oldest waiting timer has been logged or discarded. */
export function doneLogging(): void {
  toLog.set(toLog.get().slice(1));
}

export function stopTimer(): void {
  const timer = store.get();
  if (timer) {
    const elapsed = elapsedSeconds(timer, Date.now());
    logInfo(`timer stopped on ${timer.issueKey} after ${elapsed}s`);
  }
  save(null);
}

export function useTimer(): ActiveTimer | null {
  return store.use();
}

/** Milliseconds until the elapsed count rolls over to the next whole second.
 *  A `startedAt` in the future (a clock correction while the timer ran) waits
 *  out the difference rather than returning something negative. */
export function msToNextSecond(now: number, startedAt: number): number {
  const elapsed = now - startedAt;
  return elapsed < 0 ? -elapsed : 1000 - (elapsed % 1000);
}

/** Elapsed whole seconds of running time, ticking every second while the
 *  timer runs and standing still while it is paused. */
export function useElapsedSeconds(timer: ActiveTimer | null): number {
  const [now, setNow] = useState(() => Date.now());
  // Keyed on the clock's origin, not the timer object: a new object identity
  // for the same running timer would restart the ticking on every render, and
  // the origin is what the elapsed count is actually derived from. Pausing or
  // stopping (origin → null/undefined) changes it, so the effect still re-runs
  // and cancels the pending tick; resuming moves it, so ticking starts afresh.
  const origin = timer ? clockOrigin(timer) : undefined;
  useEffect(() => {
    if (origin === undefined || origin === null) return;
    // Each tick aims at the moment the count actually changes instead of a
    // flat second later. A fixed interval drifts — every wake-up lands a little
    // late and the error accumulates — until the displayed clock visibly skips
    // a second. Re-aiming from the current time each round keeps it honest,
    // and keeps it in step with the tray's copy of the same clock.
    let id: number;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, msToNextSecond(Date.now(), origin));
    };
    // The first tick straight away rather than at the next whole second: a
    // timer started while the clock stood still would otherwise show the old
    // reading for up to a second.
    id = window.setTimeout(tick, 0);
    return () => window.clearTimeout(id);
  }, [origin]);
  if (!timer) return 0;
  return elapsedSeconds(timer, now);
}

/** Round seconds up to the next 15-minute increment (minimum 15 min). */
export function roundUpToQuarterHour(seconds: number): number {
  return Math.max(900, Math.ceil(seconds / 900) * 900);
}

/** Does the running clock currently read as something worth a wink — a
 *  Schnapszahl (every digit the same: 11:11, 2:22:22, 11:11:11 …) or 13:37?
 *  Purely decorative; the timer bar flashes for that one second.
 *
 *  Zero is excluded on purpose, or every timer would wink the moment it
 *  starts on 00:00. */
export function isPlayfulClock(totalSeconds: number): boolean {
  if (totalSeconds <= 0) return false;
  const clock = formatClock(totalSeconds);
  // Matches "13:37" as well as "1:13:37" — the minutes and seconds are what
  // reads as leet, whatever the hour.
  if (clock.endsWith("13:37")) return true;
  const digits = clock.replace(/:/g, "");
  return [...digits].every((d) => d === digits[0]);
}

/** Format seconds as a running clock (m:ss, or h:mm:ss past an hour). */
export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
