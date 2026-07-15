import { useEffect, useState, useSyncExternalStore } from "react";

export interface ActiveTimer {
  issueKey: string;
  issueSummary: string;
  startedAt: number; // epoch ms
}

const STORAGE_KEY = "performa-active-timer";
const listeners = new Set<() => void>();

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
let current: ActiveTimer | null = read();

export function getTimer(): ActiveTimer | null {
  return current;
}

export function startTimer(issueKey: string, issueSummary: string): void {
  current = { issueKey, issueSummary, startedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  emit();
}

export function stopTimer(): void {
  current = null;
  localStorage.removeItem(STORAGE_KEY);
  emit();
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimer(): ActiveTimer | null {
  return useSyncExternalStore(subscribe, getTimer, getTimer);
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
