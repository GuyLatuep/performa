import { describe, expect, it } from "vitest";
import { WorklogEntry } from "./api";
import { weekBars } from "./weekBars";

/** Monday 2026-03-16, so the week runs Mon 16th to Sun 22nd. */
const MONDAY = "2026-03-16";

const HOUR = 3600;
const TARGET = 8 * HOUR;

function entry(date: string, seconds: number): WorklogEntry {
  return {
    id: date + seconds,
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    timeSpentSeconds: seconds,
    date,
    time: "09:00",
    comment: "",
    billable: true,
  };
}

const weekdays = { dayTarget: TARGET, showWeekends: false };

describe("the seven days", () => {
  it("buckets each entry onto its own day", () => {
    const { days } = weekBars(
      MONDAY,
      [entry("2026-03-16", HOUR), entry("2026-03-18", 2 * HOUR)],
      weekdays,
    );

    expect(days.map((d) => d.seconds)).toEqual([HOUR, 0, 2 * HOUR, 0, 0]);
  });

  it("adds up several entries on one day", () => {
    const { days } = weekBars(
      MONDAY,
      [entry("2026-03-16", HOUR), entry("2026-03-16", 1800)],
      weekdays,
    );

    expect(days[0].seconds).toBe(HOUR + 1800);
  });

  it("ignores entries outside the week", () => {
    // The caller fetches by range, but a repeat booked from another week can
    // arrive in the same list.
    const { days, total } = weekBars(
      MONDAY,
      [entry("2026-03-09", HOUR), entry("2026-03-23", HOUR)],
      weekdays,
    );

    expect(total).toBe(0);
    expect(days.every((d) => d.seconds === 0)).toBe(true);
  });

  it("runs from the given Monday, in local time", () => {
    // A bare "yyyy-MM-dd" parses as UTC and shifts the whole week west of
    // Greenwich — the bug the CI timezone matrix exists to catch.
    const { days } = weekBars(MONDAY, [], { ...weekdays, showWeekends: true });

    expect(days.map((d) => d.date)).toEqual([
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
    ]);
  });
});

describe("weekends", () => {
  it("hides them by default", () => {
    const { days } = weekBars(MONDAY, [], weekdays);

    expect(days).toHaveLength(5);
  });

  it("shows them when the setting asks", () => {
    const { days } = weekBars(MONDAY, [], { ...weekdays, showWeekends: true });

    expect(days).toHaveLength(7);
  });

  it("shows a hidden weekend day that has time on it", () => {
    // No bar may silently disappear: time logged on Saturday has to be
    // visible whether or not weekends are on.
    const { days } = weekBars(MONDAY, [entry("2026-03-21", HOUR)], weekdays);

    expect(days).toHaveLength(6);
    expect(days[days.length - 1]).toMatchObject({
      date: "2026-03-21",
      seconds: HOUR,
    });
  });

  it("still leaves out the empty half of a worked weekend", () => {
    const { days } = weekBars(MONDAY, [entry("2026-03-21", HOUR)], weekdays);

    expect(days.map((d) => d.date)).not.toContain("2026-03-22");
  });
});

describe("scaleMax", () => {
  it("is the daily target while every day is under it", () => {
    const { scaleMax } = weekBars(
      MONDAY,
      [entry("2026-03-16", HOUR)],
      weekdays,
    );

    expect(scaleMax).toBe(TARGET);
  });

  it("grows to the longest day so an overshoot still fits", () => {
    const long = 11 * HOUR;
    const { scaleMax } = weekBars(
      MONDAY,
      [entry("2026-03-16", long)],
      weekdays,
    );

    expect(scaleMax).toBe(long);
  });

  it("is never zero, so a height can always be divided by it", () => {
    // With no target and nothing logged, every bar divides by this.
    const { scaleMax } = weekBars(MONDAY, [], {
      dayTarget: 0,
      showWeekends: false,
    });

    expect(scaleMax).toBe(1);
  });
});

describe("the week total and its fraction", () => {
  it("counts weekend time, which the weekday-only view would otherwise lose", () => {
    // The ring is about the week, not about the target: time booked on a
    // Sunday still counts towards it. (That Sunday is also *shown*, by the
    // rule above — the two work together rather than against each other.)
    const { total } = weekBars(
      MONDAY,
      [entry("2026-03-16", HOUR), entry("2026-03-22", HOUR)],
      weekdays,
    );

    expect(total).toBe(2 * HOUR);
  });

  it("is the fraction of a five-day target", () => {
    const { pct } = weekBars(
      MONDAY,
      [entry("2026-03-16", TARGET), entry("2026-03-17", TARGET)],
      weekdays,
    );

    expect(pct).toBeCloseTo(2 / 5, 10);
  });

  it("goes past one for a week that ran over", () => {
    // Clamping belongs to the ring that draws it; the number beside it should
    // say what actually happened.
    const { pct } = weekBars(
      MONDAY,
      Array.from({ length: 5 }, (_, i) =>
        entry(`2026-03-${16 + i}`, TARGET + HOUR),
      ),
      weekdays,
    );

    expect(pct).toBeGreaterThan(1);
  });

  it("is zero rather than infinite when there is no target", () => {
    const { pct } = weekBars(MONDAY, [entry("2026-03-16", HOUR)], {
      dayTarget: 0,
      showWeekends: false,
    });

    expect(pct).toBe(0);
  });

  it("is zero for an empty week", () => {
    expect(weekBars(MONDAY, [], weekdays)).toMatchObject({ total: 0, pct: 0 });
  });
});
