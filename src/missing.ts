import { useSyncExternalStore } from "react";
import { api, MissingWorklog } from "./api";

// Background watcher behind the "Missing worklog" tab: polls Jira for recent
// own activity (comments / status changes) without a nearby worklog, and
// remembers which findings the user has already looked at so the tab only
// blinks for new ones.

const SEEN_KEY = "performa-missing-seen";
const POLL_MS = 2 * 60 * 1000;

let items: MissingWorklog[] = [];
let unseenCount = 0;
let lastError: string | null = null;
let lastChecked: string | null = null; // HH:mm of the last completed check
let pollId: number | undefined;
const listeners = new Set<() => void>();

const sig = (item: MissingWorklog) => `${item.issueKey}@${item.activityAt}`;

function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    if (Array.isArray(raw)) {
      return new Set(raw.filter((s) => typeof s === "string"));
    }
  } catch {
    /* ignore malformed storage */
  }
  return new Set();
}

function recompute() {
  const seen = readSeen();
  unseenCount = items.filter((i) => !seen.has(sig(i))).length;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMissing(): MissingWorklog[] {
  return items;
}

export async function refreshMissing(): Promise<void> {
  try {
    items = await api.missingWorklogs();
    lastError = null;
  } catch (err) {
    lastError = String(err);
  }
  lastChecked = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  recompute();
  emit();
}

export function startMissingPolling(): void {
  if (pollId !== undefined) return;
  refreshMissing();
  pollId = window.setInterval(refreshMissing, POLL_MS);
}

export function stopMissingPolling(): void {
  if (pollId === undefined) return;
  window.clearInterval(pollId);
  pollId = undefined;
  items = [];
  unseenCount = 0;
  lastError = null;
  lastChecked = null;
  emit();
}

/** Acknowledge the current findings so the tab stops blinking for them. */
export function markMissingSeen(): void {
  localStorage.setItem(SEEN_KEY, JSON.stringify(items.map(sig)));
  recompute();
  emit();
}

export function useMissing(): MissingWorklog[] {
  return useSyncExternalStore(subscribe, getMissing, getMissing);
}

export function useMissingUnseenCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => unseenCount,
    () => unseenCount,
  );
}

export function useMissingError(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => lastError,
    () => lastError,
  );
}

export function useMissingLastChecked(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => lastChecked,
    () => lastChecked,
  );
}
