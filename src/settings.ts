import { api } from "./api";
import { LOG_LEVELS, LogLevel, logError } from "./log";
import { MonthSortBy } from "./monthGrid";
import { persistedText } from "./persist";

// Local app settings (nothing secret — credentials live in the OS keychain).
// What a day is expected to hold lives in `workdays.ts`; the weekend toggle
// here only decides which days the charts show.

const WEEKENDS_KEY = "performa-show-weekends";
const LOG_LEVEL_KEY = "performa-log-level";
const FUN_MODE_KEY = "performa-fun-mode";
const TYPE_ICONS_KEY = "performa-show-issue-type-icons";
const TIMESHEET_VIEW_KEY = "performa-timesheet-view";
const MONTH_SORT_KEY = "performa-month-sort";
const IDLE_MINUTES_KEY = "performa-idle-minutes";
const DEFAULT_IDLE_MINUTES = 10;
/** The longest idle threshold on offer: past half a day, "away" means
 *  "went home", which the timer bar already says plainly enough. */
export const MAX_IDLE_MINUTES = 240;
const DEFAULT_LOG_LEVEL: LogLevel = "error";

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

/** Minutes without input after which a running timer asks about the time
 *  away. Zero turns the watch off. */
const idleMinutesStore = persistedText<number>(IDLE_MINUTES_KEY, (raw) => {
  if (raw === null) return DEFAULT_IDLE_MINUTES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_IDLE_MINUTES
    ? n
    : DEFAULT_IDLE_MINUTES;
});

export function getIdleMinutes(): number {
  return idleMinutesStore.get();
}

export function setIdleMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_IDLE_MINUTES)
    return;
  idleMinutesStore.save(minutes);
}

export function useIdleMinutes(): number {
  return idleMinutesStore.use();
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
  api
    .setLogLevel(level)
    .catch((err) => logError(`set_log_level(${level}) failed: ${err}`));
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

/** How the month matrix orders its rows. Remembered the same way the view
 *  itself is: it belongs to the month grid, not the settings screen. */
const monthSortStore = persistedText<MonthSortBy>(MONTH_SORT_KEY, (raw) =>
  raw === "total" ? "total" : "key",
);

export function getMonthSortBy(): MonthSortBy {
  return monthSortStore.get();
}

export function setMonthSortBy(sortBy: MonthSortBy): void {
  monthSortStore.save(sortBy);
}

export function useMonthSortBy(): MonthSortBy {
  return monthSortStore.use();
}
