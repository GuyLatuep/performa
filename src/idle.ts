import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logDebug, logInfo } from "./log";
import { useIdleMinutes } from "./settings";
import { createStore } from "./store";
import {
  ActiveTimer,
  clockOrigin,
  getTimer,
  runningMsWithin,
  timerStartedAt,
  useTimer,
} from "./timer";

/**
 * Idle time: a stretch with no input at the machine while a timer ran.
 *
 * The timer cannot tell work from absence — it counts wall-clock time — so a
 * timer left running over lunch books lunch. This watches the OS's own idle
 * reading while a timer runs and, once the user is back, asks what the time
 * away was. Never while they are away: nobody is there to answer.
 */

/** An away stretch, as epoch ms: from the last input before it to the first
 *  input after it. */
export interface Away {
  from: number;
  to: number;
}

export interface IdleState {
  /** When the current away stretch began, once it has passed the threshold. */
  awaySince: number | null;
  /** The previous reading: when it was taken, the last input it saw, and the
   *  machine's time asleep so far. */
  lastPoll: number | null;
  lastInput: number | null;
  lastAsleepMs: number | null;
}

export const IDLE_START: IdleState = {
  awaySince: null,
  lastPoll: null,
  lastInput: null,
  lastAsleepMs: null,
};

/** What the OS reports; see `idle.rs`. */
export interface IdleReading {
  idleSeconds: number;
  asleepMs: number;
}

/** Less sleep than this between two readings is a blip, not an absence. */
const SLEEP_BLIP_MS = 60_000;

/** How often the reading is taken while a timer runs. */
export const POLL_MS = 15_000;

/**
 * One reading, judged. Pure, so the cases that matter — a sleep the poller
 * never saw, a return just under the threshold — are a table rather than a
 * machine to drive.
 *
 * Sleep needs its own rule: a sleeping machine runs no poller, and on waking
 * the OS's idle counter may already have been reset by the key that woke it.
 * The OS's time-asleep reading going up between two readings is that sleep,
 * and the away stretch starts at the last input seen before it. A long gap
 * alone proves nothing — a hidden window's poller can be held back while the
 * user works on elsewhere — which is why the gap is not the test.
 */
export function observeIdle(
  state: IdleState,
  reading: IdleReading & { now: number; thresholdMs: number },
): { state: IdleState; away: Away | null } {
  const { now, idleSeconds, asleepMs, thresholdMs } = reading;
  const lastInput = now - Math.max(0, idleSeconds) * 1000;
  let awaySince = state.awaySince;

  const slept =
    state.lastAsleepMs !== null &&
    asleepMs - state.lastAsleepMs >= SLEEP_BLIP_MS;
  if (slept) {
    const leftAt = state.lastInput ?? state.lastPoll ?? lastInput;
    awaySince = Math.min(awaySince ?? leftAt, leftAt);
  }

  const next = (away: Away | null, since: number | null) => ({
    state: {
      awaySince: since,
      lastPoll: now,
      lastInput,
      lastAsleepMs: asleepMs,
    },
    away,
  });

  if (now - lastInput >= thresholdMs) {
    return next(null, Math.min(awaySince ?? lastInput, lastInput));
  }
  if (awaySince === null) return next(null, null);

  // Back. The input that ended the stretch is its end.
  const to = Math.max(awaySince, lastInput);
  return next(
    to - awaySince >= thresholdMs ? { from: awaySince, to } : null,
    null,
  );
}

/** An away stretch put to the user, and the timer it was counted on. The
 *  answer only ever applies to that timer: once it is stopped or switched
 *  away from, the question is moot rather than about the next one. */
export interface IdleQuestion extends Away {
  timerId: string;
}

/** Which timer this is: its issue and when it began. A new timer — even on
 *  the same issue — is a different one. */
export function timerId(timer: ActiveTimer): string {
  return `${timer.issueKey ?? ""}@${timerStartedAt(timer)}`;
}

/** The question waiting to be answered, if any. One at a time: a second away
 *  stretch on the same timer before the first is answered folds into it. */
const prompt = createStore<IdleQuestion | null>(null);

export function useIdlePrompt(): IdleQuestion | null {
  return prompt.use();
}

/** Whether `question` is still about the timer running now. */
export function isCurrent(
  question: IdleQuestion,
  timer: ActiveTimer | null,
): boolean {
  return timer !== null && timerId(timer) === question.timerId;
}

export function closeIdlePrompt(): void {
  prompt.set(null);
}

/** Ask about an away stretch on the timer running now. Exported for the
 *  watch below and for tests. */
export function raiseIdlePrompt(away: Away): void {
  const timer = getTimer();
  if (!timer) return;
  const id = timerId(timer);
  const open = prompt.get();
  prompt.set(
    open && open.timerId === id
      ? {
          timerId: id,
          from: Math.min(open.from, away.from),
          to: Math.max(open.to, away.to),
        }
      : { ...away, timerId: id },
  );
  // A question nobody sees is no question: bring the window forward.
  invoke("show_main_window").catch((err) =>
    logDebug(`show_main_window failed: ${err}`),
  );
}

/**
 * Watch for idle time while a timer runs. Mounted once, by the app shell.
 *
 * Only while the clock is actually running: a paused timer counts nothing, so
 * there is nothing to ask about, and with the watch off (zero minutes) nothing
 * is read at all.
 */
export function useIdleWatch(): void {
  const minutes = useIdleMinutes();
  const timer = useTimer();
  const running = timer !== null && clockOrigin(timer) !== null;

  useEffect(() => {
    if (!running || minutes === 0) return;
    const thresholdMs = minutes * 60_000;
    let state = IDLE_START;
    let cancelled = false;

    const poll = async () => {
      let reading: IdleReading;
      try {
        reading = await invoke<IdleReading>("idle_reading");
      } catch (err) {
        logDebug(`idle_reading failed: ${err}`);
        return;
      }
      if (cancelled) return;
      const result = observeIdle(state, {
        ...reading,
        now: Date.now(),
        thresholdMs,
      });
      state = result.state;
      const away = result.away;
      const t = getTimer();
      // Only what the timer actually counted is worth asking about.
      if (away && t && runningMsWithin(t, away.from, away.to) >= thresholdMs) {
        logInfo(
          `idle: away ${Math.round((away.to - away.from) / 60_000)} min while timing`,
        );
        raiseIdlePrompt(away);
      }
    };

    // A reading straight away, so a sleep that ends before the first interval
    // still has a "before" to measure against.
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, minutes]);
}
