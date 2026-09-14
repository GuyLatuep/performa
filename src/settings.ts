import { api } from "./api";
import { LOG_LEVELS, LogLevel } from "./log";
import { persistedText } from "./persist";

// Local app settings (nothing secret — credentials live in the OS keychain).
// Daily work hours and the weekend toggle power the timesheet charts.

const HOURS_KEY = "performa-daily-hours";
const WEEKENDS_KEY = "performa-show-weekends";
const LOG_LEVEL_KEY = "performa-log-level";
const FUN_MODE_KEY = "performa-fun-mode";
const TYPE_ICONS_KEY = "performa-show-issue-type-icons";
const TIMESHEET_VIEW_KEY = "performa-timesheet-view";
const DEFAULT_DAILY_HOURS = 8;
const DEFAULT_LOG_LEVEL: LogLevel = "error";

/** Working days per week used for the weekly target. */
export const WORKDAYS_PER_WEEK = 5;

const hoursStore = persistedText<number>(HOURS_KEY, (raw) => {
  const n = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : DEFAULT_DAILY_HOURS;
});
const weekendsStore = persistedText<boolean>(
  WEEKENDS_KEY,
  (raw) => raw === "true",
);
const funModeStore = persistedText<boolean>(
  FUN_MODE_KEY,
  (raw) => raw === "true",
);
// On unless it has been turned off — the icons are the default look of a list,
// and anyone who has never opened the setting should see them. That is why this
// one reads for "false" rather than for "true" like the toggles above.
const typeIconsStore = persistedText<boolean>(
  TYPE_ICONS_KEY,
  (raw) => raw !== "false",
);

export function getDailyHours(): number {
  return hoursStore.get();
}

export function setDailyHours(hours: number): void {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return;
  hoursStore.save(hours);
}

export function useDailyHours(): number {
  return hoursStore.use();
}

export function getShowWeekends(): boolean {
  return weekendsStore.get();
}

export function setShowWeekends(value: boolean): void {
  weekendsStore.save(value);
}

export function useShowWeekends(): boolean {
  return weekendsStore.use();
}

const logLevelStore = persistedText<LogLevel>(LOG_LEVEL_KEY, (raw) =>
  (LOG_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as LogLevel)
    : DEFAULT_LOG_LEVEL,
);

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
  logLevelStore.save(level);
  syncLogLevel(level);
}

export function useLogLevel(): LogLevel {
  return logLevelStore.use();
}

export function getFunMode(): boolean {
  return funModeStore.get();
}

export function setFunMode(on: boolean): void {
  funModeStore.save(on);
}

export function useFunMode(): boolean {
  return funModeStore.use();
}

export function getShowIssueTypeIcons(): boolean {
  return typeIconsStore.get();
}

export function setShowIssueTypeIcons(on: boolean): void {
  typeIconsStore.save(on);
}

export function useShowIssueTypeIcons(): boolean {
  return typeIconsStore.use();
}

/** Which shape the timesheet tab is in: the week ledger or the month matrix.
 *
 *  Remembered rather than configured — it is a view toggle, not a preference,
 *  so it belongs next to the tab it lives on and not in the settings screen.
 *  A fresh install starts on the week: the month matrix wants a wide window,
 *  and the week is the view that reads on any of them. */
export type TimesheetView = "week" | "month";

const timesheetViewStore = persistedText<TimesheetView>(
  TIMESHEET_VIEW_KEY,
  (raw) => (raw === "month" ? "month" : "week"),
);

export function getTimesheetView(): TimesheetView {
  return timesheetViewStore.get();
}

export function setTimesheetView(view: TimesheetView): void {
  timesheetViewStore.save(view);
}

export function useTimesheetView(): TimesheetView {
  return timesheetViewStore.use();
}
