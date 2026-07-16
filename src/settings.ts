import { useSyncExternalStore } from "react";

// Local app settings (nothing secret — credentials live in the OS keychain).
// Currently just the user's regular daily work hours, which power the
// timesheet charts.

const HOURS_KEY = "performa-daily-hours";
const WEEKENDS_KEY = "performa-show-weekends";
const DEFAULT_DAILY_HOURS = 8;

/** Working days per week used for the weekly target. */
export const WORKDAYS_PER_WEEK = 5;

const listeners = new Set<() => void>();

function read(): number {
  const raw = localStorage.getItem(HOURS_KEY);
  const n = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : DEFAULT_DAILY_HOURS;
}

let dailyHours = read();
let showWeekends = localStorage.getItem(WEEKENDS_KEY) === "true";

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDailyHours(): number {
  return dailyHours;
}

export function setDailyHours(hours: number): void {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return;
  dailyHours = hours;
  localStorage.setItem(HOURS_KEY, String(hours));
  emit();
}

export function useDailyHours(): number {
  return useSyncExternalStore(subscribe, getDailyHours, getDailyHours);
}

export function getShowWeekends(): boolean {
  return showWeekends;
}

export function setShowWeekends(value: boolean): void {
  showWeekends = value;
  localStorage.setItem(WEEKENDS_KEY, String(value));
  emit();
}

export function useShowWeekends(): boolean {
  return useSyncExternalStore(subscribe, getShowWeekends, getShowWeekends);
}
