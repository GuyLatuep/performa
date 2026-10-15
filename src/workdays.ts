import { persisted, persistedText, readStored } from "./persist";
import { atMidnight, toDateInput } from "./time";

/**
 * What a day is expected to hold: the Daily target, and why it is what it is.
 *
 * Three inputs decide it. The **Daily target** per weekday — part-time is a
 * shorter Friday, not a smaller average. **Holidays**, the legal ones of the
 * user's German state, computed rather than looked up so the app needs no
 * service for them. And **Absences**, days the user marks off themselves,
 * whole or half.
 *
 * A Holiday is not an Absence. A Holiday is the law's — the same for everyone
 * in the state, never entered by anybody. An Absence is the user's own —
 * vacation, sickness, a day in lieu. Both lower what a day is expected to
 * hold; neither is a day "behind".
 */

// ----- Holidays ----------------------------------------------------------------

export const GERMAN_STATES = [
  { code: "BW", name: "Baden-Württemberg" },
  { code: "BY", name: "Bayern" },
  { code: "BE", name: "Berlin" },
  { code: "BB", name: "Brandenburg" },
  { code: "HB", name: "Bremen" },
  { code: "HH", name: "Hamburg" },
  { code: "HE", name: "Hessen" },
  { code: "MV", name: "Mecklenburg-Vorpommern" },
  { code: "NI", name: "Niedersachsen" },
  { code: "NW", name: "Nordrhein-Westfalen" },
  { code: "RP", name: "Rheinland-Pfalz" },
  { code: "SL", name: "Saarland" },
  { code: "SN", name: "Sachsen" },
  { code: "ST", name: "Sachsen-Anhalt" },
  { code: "SH", name: "Schleswig-Holstein" },
  { code: "TH", name: "Thüringen" },
] as const;

export type GermanState = (typeof GERMAN_STATES)[number]["code"];

const isState = (v: unknown): v is GermanState =>
  GERMAN_STATES.some((s) => s.code === v);

/** Easter Sunday (Gregorian), by the anonymous Gregorian algorithm. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function plusDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

const fixed = (year: number, month: number, day: number) =>
  toDateInput(new Date(year, month - 1, day));

/**
 * The legal public holidays of one year in one state, by date.
 *
 * Statewide holidays only: a holiday that only some municipalities keep
 * (Mariä Himmelfahrt in parts of Bayern, Fronleichnam in parts of Sachsen and
 * Thüringen) is left for the user to mark as an Absence, since the state
 * alone cannot say whether it applies. Sundays that happen to be holidays
 * (Ostersonntag, Pfingstsonntag) are left out — a Sunday asks for nothing.
 */
export function germanHolidays(
  year: number,
  state: GermanState | null,
): Map<string, string> {
  const days = new Map<string, string>();
  if (!state) return days;
  const easter = easterSunday(year);
  const add = (date: string, name: string) => days.set(date, name);
  const inState = (...states: GermanState[]) => states.includes(state);

  add(fixed(year, 1, 1), "Neujahr");
  add(plusDays(easter, -2), "Karfreitag");
  add(plusDays(easter, 1), "Ostermontag");
  add(fixed(year, 5, 1), "Tag der Arbeit");
  add(plusDays(easter, 39), "Christi Himmelfahrt");
  add(plusDays(easter, 50), "Pfingstmontag");
  add(fixed(year, 10, 3), "Tag der Deutschen Einheit");
  add(fixed(year, 12, 25), "1. Weihnachtstag");
  add(fixed(year, 12, 26), "2. Weihnachtstag");

  if (inState("BW", "BY", "ST")) add(fixed(year, 1, 6), "Heilige Drei Könige");
  if ((inState("BE") && year >= 2019) || (inState("MV") && year >= 2023))
    add(fixed(year, 3, 8), "Internationaler Frauentag");
  if (inState("BE") && (year === 2020 || year === 2025))
    add(fixed(year, 5, 8), "Tag der Befreiung");
  if (inState("BW", "BY", "HE", "NW", "RP", "SL"))
    add(plusDays(easter, 60), "Fronleichnam");
  if (inState("SL")) add(fixed(year, 8, 15), "Mariä Himmelfahrt");
  if (inState("TH") && year >= 2019) add(fixed(year, 9, 20), "Weltkindertag");
  // Reformation Day: long-standing in the east, since 2018 in four northern
  // states, and once, in 2017, everywhere.
  if (
    year === 2017 ||
    inState("BB", "MV", "SN", "ST", "TH") ||
    (inState("HB", "HH", "NI", "SH") && year >= 2018)
  )
    add(fixed(year, 10, 31), "Reformationstag");
  if (inState("BW", "BY", "NW", "RP", "SL"))
    add(fixed(year, 11, 1), "Allerheiligen");
  if (inState("SN")) {
    // The Wednesday before 23 November.
    const nov22 = new Date(year, 10, 22);
    const back = (nov22.getDay() - 3 + 7) % 7;
    add(plusDays(nov22, -back), "Buß- und Bettag");
  }
  return days;
}

// ----- Absences ---------------------------------------------------------------

export type AbsenceKind = "vacation" | "sick" | "other";

export interface Absence {
  date: string;
  /** A whole day, or half of one. */
  portion: 1 | 0.5;
  kind: AbsenceKind;
}

export const ABSENCE_KINDS: { kind: AbsenceKind; label: string }[] = [
  { kind: "vacation", label: "Vacation" },
  { kind: "sick", label: "Sick" },
  { kind: "other", label: "Other" },
];

const ABSENCES_KEY = "performa-absences";

function parseAbsence(raw: unknown): Absence | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date))
    return null;
  const portion = a.portion === 0.5 ? 0.5 : 1;
  const kind = ABSENCE_KINDS.some((k) => k.kind === a.kind)
    ? (a.kind as AbsenceKind)
    : "other";
  return { date: a.date, portion, kind };
}

const absenceStore = persisted<Absence[]>(ABSENCES_KEY, (stored) =>
  Array.isArray(stored)
    ? stored.map(parseAbsence).filter((a): a is Absence => a !== null)
    : [],
);

export function getAbsences(): Absence[] {
  return absenceStore.get();
}

export function useAbsences(): Absence[] {
  return absenceStore.use();
}

/** Mark days off. One entry per date: marking a date again replaces it. */
export function addAbsences(entries: Absence[]): void {
  const dates = new Set(entries.map((e) => e.date));
  const kept = absenceStore.get().filter((a) => !dates.has(a.date));
  absenceStore.save(
    [...kept, ...entries].sort((x, y) => x.date.localeCompare(y.date)),
  );
}

export function removeAbsence(date: string): void {
  absenceStore.save(absenceStore.get().filter((a) => a.date !== date));
}

// ----- Daily targets -----------------------------------------------------------

const WEEKDAY_HOURS_KEY = "performa-weekday-hours";
const STATE_KEY = "performa-holiday-state";
/** Written by versions before targets went per weekday — as a bare number,
 *  which reads as JSON just the same. Read once, as the starting point, so an
 *  update changes nobody's targets. */
const LEGACY_HOURS_KEY = "performa-daily-hours";
const DEFAULT_DAILY_HOURS = 8;

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const validHours = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 24;

function legacyWeek(): number[] {
  const raw = readStored(LEGACY_HOURS_KEY);
  const h = validHours(raw) && raw > 0 ? raw : DEFAULT_DAILY_HOURS;
  return [h, h, h, h, h, 0, 0];
}

/** Hours expected on each weekday, Monday first. */
const weekdayHoursStore = persisted<number[]>(WEEKDAY_HOURS_KEY, (stored) =>
  Array.isArray(stored) && stored.length === 7 && stored.every(validHours)
    ? stored
    : legacyWeek(),
);

export function getWeekdayHours(): number[] {
  return weekdayHoursStore.get();
}

export function useWeekdayHours(): number[] {
  return weekdayHoursStore.use();
}

export function setWeekdayHours(hours: number[]): void {
  if (hours.length !== 7 || !hours.every(validHours)) return;
  weekdayHoursStore.save([...hours]);
}

const stateStore = persistedText<GermanState | null>(
  STATE_KEY,
  (raw) => (isState(raw) ? raw : null),
  (value) => value ?? "",
);

export function getHolidayState(): GermanState | null {
  return stateStore.get();
}

export function useHolidayState(): GermanState | null {
  return stateStore.use();
}

export function setHolidayState(state: GermanState | null): void {
  stateStore.save(state);
}

// ----- The day, judged --------------------------------------------------------

export type DayKind = "workday" | "weekend" | "holiday" | "absence";

export interface DayInfo {
  kind: DayKind;
  /** Seconds the day is expected to hold. */
  target: number;
  /** The Holiday's name, or the Absence's kind, for tooltips. */
  label?: string;
}

export interface WorkCalendar {
  weekdayHours: number[];
  state: GermanState | null;
  absences: Absence[];
}

/** Monday 0 … Sunday 6. */
function weekdayIndex(date: string): number {
  return (atMidnight(date).getDay() + 6) % 7;
}

/**
 * What `date` is expected to hold, and why.
 *
 * A Holiday zeroes the day. An Absence takes its portion off the day's
 * weekday target — half a day off leaves half a day to work. A day whose
 * weekday target is zero anyway is a weekend, whatever weekday it is.
 */
export function dayInfo(date: string, cal: WorkCalendar): DayInfo {
  const base = cal.weekdayHours[weekdayIndex(date)] * 3600;
  if (base <= 0) return { kind: "weekend", target: 0 };
  const year = Number(date.slice(0, 4));
  const holiday = germanHolidays(year, cal.state).get(date);
  if (holiday) return { kind: "holiday", target: 0, label: holiday };
  const absence = cal.absences.find((a) => a.date === date);
  if (absence) {
    const label = ABSENCE_KINDS.find((k) => k.kind === absence.kind)!.label;
    return {
      kind: "absence",
      target: base * (1 - absence.portion),
      label: absence.portion === 0.5 ? `${label}, half day` : label,
    };
  }
  return { kind: "workday", target: base };
}

export function getWorkCalendar(): WorkCalendar {
  return {
    weekdayHours: getWeekdayHours(),
    state: getHolidayState(),
    absences: getAbsences(),
  };
}

/** The calendar as it stands, re-rendering whoever reads it when any of its
 *  three inputs changes. */
export function useWorkCalendar(): WorkCalendar {
  return {
    weekdayHours: useWeekdayHours(),
    state: useHolidayState(),
    absences: useAbsences(),
  };
}

/** Every day from `from` to `to`, inclusive, that would otherwise be worked —
 *  what marking a stretch of vacation means. Weekends and Holidays are
 *  skipped: there is nothing to take off them. */
export function workdaysBetween(
  from: string,
  to: string,
  cal: WorkCalendar,
): string[] {
  const out: string[] = [];
  const end = atMidnight(to < from ? from : to);
  for (let d = atMidnight(from); d <= end; d.setDate(d.getDate() + 1)) {
    const date = toDateInput(d);
    if (dayInfo(date, { ...cal, absences: [] }).kind === "workday")
      out.push(date);
  }
  return out;
}
