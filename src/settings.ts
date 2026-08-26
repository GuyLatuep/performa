import { api } from "./api";
import { LOG_LEVELS, LogLevel } from "./log";
import { createStore } from "./store";

// Local app settings (nothing secret — credentials live in the OS keychain).
// Daily work hours and the weekend toggle power the timesheet charts.

const HOURS_KEY = "performa-daily-hours";
const WEEKENDS_KEY = "performa-show-weekends";
const LOG_LEVEL_KEY = "performa-log-level";
const FUN_MODE_KEY = "performa-fun-mode";
const TYPE_ICONS_KEY = "performa-show-issue-type-icons";
const DEFAULT_DAILY_HOURS = 8;
const DEFAULT_LOG_LEVEL: LogLevel = "error";

/** Working days per week used for the weekly target. */
export const WORKDAYS_PER_WEEK = 5;

function readHours(): number {
  const raw = localStorage.getItem(HOURS_KEY);
  const n = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : DEFAULT_DAILY_HOURS;
}

const hoursStore = createStore<number>(readHours());
const weekendsStore = createStore<boolean>(
  localStorage.getItem(WEEKENDS_KEY) === "true",
);
const funModeStore = createStore<boolean>(
  localStorage.getItem(FUN_MODE_KEY) === "true",
);
// On unless it has been turned off — the icons are the default look of a list,
// and anyone who has never opened the setting should see them. That is why this
// one reads for "false" rather than for "true" like the toggles above.
const typeIconsStore = createStore<boolean>(
  localStorage.getItem(TYPE_ICONS_KEY) !== "false",
);

export function getDailyHours(): number {
  return hoursStore.get();
}

export function setDailyHours(hours: number): void {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return;
  localStorage.setItem(HOURS_KEY, String(hours));
  hoursStore.set(hours);
}

export function useDailyHours(): number {
  return hoursStore.use();
}

export function getShowWeekends(): boolean {
  return weekendsStore.get();
}

export function setShowWeekends(value: boolean): void {
  localStorage.setItem(WEEKENDS_KEY, String(value));
  weekendsStore.set(value);
}

export function useShowWeekends(): boolean {
  return weekendsStore.use();
}

function readLogLevel(): LogLevel {
  const raw = localStorage.getItem(LOG_LEVEL_KEY);
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as LogLevel)
    : DEFAULT_LOG_LEVEL;
}

const logLevelStore = createStore<LogLevel>(readLogLevel());

// Rust owns the actual log file and filtering, so every level change (and
// the persisted choice at each launch) has to be mirrored over to it.
function syncLogLevel(level: LogLevel): void {
  api.setLogLevel(level).catch(() => {});
}
syncLogLevel(logLevelStore.get());

export function getLogLevel(): LogLevel {
  return logLevelStore.get();
}

export function setLogLevel(level: LogLevel): void {
  localStorage.setItem(LOG_LEVEL_KEY, level);
  logLevelStore.set(level);
  syncLogLevel(level);
}

export function useLogLevel(): LogLevel {
  return logLevelStore.use();
}

export function getFunMode(): boolean {
  return funModeStore.get();
}

export function setFunMode(on: boolean): void {
  localStorage.setItem(FUN_MODE_KEY, String(on));
  funModeStore.set(on);
}

export function useFunMode(): boolean {
  return funModeStore.use();
}

export function getShowIssueTypeIcons(): boolean {
  return typeIconsStore.get();
}

export function setShowIssueTypeIcons(on: boolean): void {
  localStorage.setItem(TYPE_ICONS_KEY, String(on));
  typeIconsStore.set(on);
}

export function useShowIssueTypeIcons(): boolean {
  return typeIconsStore.use();
}
