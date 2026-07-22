import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { logDebug, logInfo } from "./log";
import { createStore } from "./store";

export interface ActiveTimer {
  issueKey: string;
  issueSummary: string;
  startedAt: number; // epoch ms
}

const STORAGE_KEY = "performa-active-timer";

function read(): ActiveTimer | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t && typeof t.issueKey === "string" && typeof t.startedAt === "number") {
      return t;
    }
  } catch {
    /* ignore malformed storage */
  }
  return null;
}

// Persisted by start timestamp, so elapsed is computed from the wall clock and
// stays correct even if the app was closed while a timer was running.
const store = createStore<ActiveTimer | null>(read());

/** Mirror the timer to the Rust side so the system tray can display it. */
function syncTray(timer: ActiveTimer | null): void {
  const call = timer
    ? invoke("timer_started", {
        issueKey: timer.issueKey,
        startedAt: timer.startedAt,
      })
    : invoke("timer_stopped");
  // The tray is cosmetic — never let it break timing.
  call.catch((err) => logDebug(`tray sync failed: ${err}`));
}

// A timer restored from a previous run must reappear in the tray too.
if (store.get()) {
  syncTray(store.get());
}

export function getTimer(): ActiveTimer | null {
  return store.get();
}

export function startTimer(issueKey: string, issueSummary: string): void {
  const timer = { issueKey, issueSummary, startedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
  store.set(timer);
  syncTray(timer);
  logInfo(`timer started on ${issueKey}`);
  // Best-effort nudge to "In Arbeit" — must never block or fail the timer.
  // Only on a genuine start, not when a persisted timer is restored on launch.
  // api.startIssueWork already logs its own outcome (incl. failures); nothing
  // more to do here than stop it from becoming an unhandled rejection.
  api.startIssueWork(issueKey).catch(() => {});
}

export function stopTimer(): void {
  const timer = store.get();
  if (timer) {
    const elapsed = Math.floor((Date.now() - timer.startedAt) / 1000);
    logInfo(`timer stopped on ${timer.issueKey} after ${elapsed}s`);
  }
  localStorage.removeItem(STORAGE_KEY);
  store.set(null);
  syncTray(null);
}

export function useTimer(): ActiveTimer | null {
  return store.use();
}

/** Elapsed whole seconds since the timer started, ticking every second. */
export function useElapsedSeconds(timer: ActiveTimer | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer?.startedAt]);
  if (!timer) return 0;
  return Math.max(0, Math.floor((now - timer.startedAt) / 1000));
}

/** Round seconds up to the next 15-minute increment (minimum 15 min). */
export function roundUpToQuarterHour(seconds: number): number {
  return Math.max(900, Math.ceil(seconds / 900) * 900);
}

/** Format seconds as a running clock (m:ss, or h:mm:ss past an hour). */
export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
