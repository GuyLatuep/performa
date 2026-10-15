import { describe, expect, it, vi } from "vitest";
import { toDateInput } from "./time";
import {
  dayInfo,
  easterSunday,
  germanHolidays,
  WorkCalendar,
  workdaysBetween,
} from "./workdays";

const cal = (o: Partial<WorkCalendar> = {}): WorkCalendar => ({
  weekdayHours: [8, 8, 8, 8, 8, 0, 0],
  state: "NW",
  absences: [],
  ...o,
});

describe("easterSunday", () => {
  it.each([
    [2000, "2000-04-23"],
    [2019, "2019-04-21"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("falls on the right day in %i", (year, date) => {
    expect(toDateInput(easterSunday(year))).toBe(date);
  });
});

describe("germanHolidays", () => {
  it("has none without a state", () => {
    expect(germanHolidays(2026, null).size).toBe(0);
  });

  it("puts the movable feasts where Easter puts them", () => {
    const days = germanHolidays(2026, "NW");
    expect(days.get("2026-04-03")).toBe("Karfreitag");
    expect(days.get("2026-04-06")).toBe("Ostermontag");
    expect(days.get("2026-05-14")).toBe("Christi Himmelfahrt");
    expect(days.get("2026-05-25")).toBe("Pfingstmontag");
    expect(days.get("2026-06-04")).toBe("Fronleichnam");
  });

  it("keeps the state-specific ones to their states", () => {
    expect(germanHolidays(2026, "BY").get("2026-01-06")).toBe(
      "Heilige Drei Könige",
    );
    expect(germanHolidays(2026, "NW").has("2026-01-06")).toBe(false);
    expect(germanHolidays(2026, "NW").get("2026-11-01")).toBe("Allerheiligen");
    expect(germanHolidays(2026, "HH").has("2026-11-01")).toBe(false);
  });

  it("knows when a holiday was introduced", () => {
    expect(germanHolidays(2018, "BE").has("2018-03-08")).toBe(false);
    expect(germanHolidays(2019, "BE").has("2019-03-08")).toBe(true);
    expect(germanHolidays(2017, "HH").has("2017-10-31")).toBe(true); // 500 years
    expect(germanHolidays(2016, "HH").has("2016-10-31")).toBe(false);
    expect(germanHolidays(2018, "HH").has("2018-10-31")).toBe(true);
  });

  it.each([
    [2024, "2024-11-20"],
    [2025, "2025-11-19"],
    [2026, "2026-11-18"],
  ])("puts Buß- und Bettag %i on the Wednesday before 23 November", (y, d) => {
    expect(germanHolidays(y, "SN").get(d)).toBe("Buß- und Bettag");
  });

  it("leaves Christmas Eve and New Year's Eve to the user", () => {
    const days = germanHolidays(2026, "BY");
    expect(days.has("2026-12-24")).toBe(false);
    expect(days.has("2026-12-31")).toBe(false);
  });
});

describe("dayInfo", () => {
  it("expects the weekday's hours on an ordinary day", () => {
    expect(dayInfo("2026-10-14", cal())).toEqual({
      kind: "workday",
      target: 8 * 3600,
    });
  });

  it("follows a short Friday", () => {
    const parttime = cal({ weekdayHours: [8, 8, 8, 8, 4, 0, 0] });
    expect(dayInfo("2026-10-16", parttime).target).toBe(4 * 3600);
  });

  it("zeroes a holiday and names it", () => {
    expect(
      dayInfo("2026-10-03", cal({ weekdayHours: [8, 8, 8, 8, 8, 8, 0] })),
    ).toEqual({
      kind: "holiday",
      target: 0,
      label: "Tag der Deutschen Einheit",
    });
  });

  it("takes a whole day off to nothing and half a day off to half", () => {
    const off = cal({
      absences: [
        { date: "2026-10-13", portion: 1, kind: "vacation" },
        { date: "2026-10-14", portion: 0.5, kind: "sick" },
      ],
    });
    expect(dayInfo("2026-10-13", off)).toEqual({
      kind: "absence",
      target: 0,
      label: "Vacation",
    });
    expect(dayInfo("2026-10-14", off)).toEqual({
      kind: "absence",
      target: 4 * 3600,
      label: "Sick, half day",
    });
  });

  it("calls a day with no hours a weekend, whatever it holds", () => {
    expect(dayInfo("2026-10-17", cal()).kind).toBe("weekend");
    // A holiday on a Saturday nobody works is still just a weekend.
    expect(dayInfo("2026-10-03", cal()).kind).toBe("weekend");
  });
});

describe("workdaysBetween", () => {
  it("skips weekends and holidays", () => {
    // Thu 1 Oct … Tue 6 Oct 2026; the 3rd is a Saturday and a holiday.
    expect(workdaysBetween("2026-10-01", "2026-10-06", cal())).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
      "2026-10-06",
    ]);
  });

  it("reads a reversed stretch as the single start day", () => {
    expect(workdaysBetween("2026-10-14", "2026-10-01", cal())).toEqual([
      "2026-10-14",
    ]);
  });
});

describe("the stored settings", () => {
  async function fresh(seed: Record<string, string> = {}) {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    vi.resetModules();
    return import("./workdays");
  }

  it("starts from the old single daily target, Mon–Fri", async () => {
    // What an install updated from before weekday targets holds.
    const w = await fresh({ "performa-daily-hours": "7.5" });
    expect(w.getWeekdayHours()).toEqual([7.5, 7.5, 7.5, 7.5, 7.5, 0, 0]);
  });

  it("defaults to eight hours a weekday on a fresh install", async () => {
    const w = await fresh();
    expect(w.getWeekdayHours()).toEqual([8, 8, 8, 8, 8, 0, 0]);
  });

  it("refuses a week that is not seven sensible days", async () => {
    const w = await fresh();
    w.setWeekdayHours([8, 8, 8]);
    w.setWeekdayHours([8, 8, 8, 8, 8, 0, 25]);
    w.setWeekdayHours([8, 8, 8, 8, 8, 0, -1]);
    expect(w.getWeekdayHours()).toEqual([8, 8, 8, 8, 8, 0, 0]);
  });

  it("keeps one absence per date, sorted", async () => {
    const w = await fresh();
    w.addAbsences([{ date: "2026-12-31", portion: 0.5, kind: "vacation" }]);
    w.addAbsences([
      { date: "2026-12-24", portion: 0.5, kind: "vacation" },
      { date: "2026-12-31", portion: 1, kind: "other" },
    ]);
    expect(w.getAbsences()).toEqual([
      { date: "2026-12-24", portion: 0.5, kind: "vacation" },
      { date: "2026-12-31", portion: 1, kind: "other" },
    ]);
  });

  it("forgets an unknown state", async () => {
    const w = await fresh({ "performa-holiday-state": "XX" });
    expect(w.getHolidayState()).toBeNull();
  });
});
