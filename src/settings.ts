import { createStore } from "./store";

// Local app settings (nothing secret — credentials live in the OS keychain).
// Daily work hours and the weekend toggle power the timesheet charts.

const HOURS_KEY = "performa-daily-hours";
const WEEKENDS_KEY = "performa-show-weekends";
const DEFAULT_DAILY_HOURS = 8;

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
