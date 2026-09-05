/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { WorklogEntry } from "../api";

const recordEvent = vi.hoisted(() => vi.fn());
vi.mock("../achievements", () => ({ recordEvent }));

import { setDailyHours, setFunMode, setShowWeekends } from "../settings";
import { worklogEntry } from "../test-support/api";
import WeekChart from "./WeekChart";

// The arithmetic behind the bars lives in weekBars.ts and is tested there;
// this is about what gets drawn from it.

const MONDAY = "2026-03-16";
const HOUR = 3600;

function entries(...pairs: [string, number][]): WorklogEntry[] {
  return pairs.map(([date, seconds], i) =>
    worklogEntry({ id: `w${i}`, date, timeSpentSeconds: seconds }),
  );
}

beforeEach(() => {
  localStorage.clear();
  // Module-level stores outlive a test.
  setDailyHours(8);
  setShowWeekends(false);
  setFunMode(false);
  recordEvent.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the day bars", () => {
  it("draws a column per weekday, with the target line labelled", () => {
    const { container } = render(<WeekChart start={MONDAY} entries={[]} />);

    expect(container.querySelectorAll(".day-col")).toHaveLength(5);
    expect(screen.getByText("8h")).toBeDefined();
  });

  it("draws a bar only for a day that has time on it", () => {
    const { container } = render(
      <WeekChart start={MONDAY} entries={entries([MONDAY, HOUR])} />,
    );

    expect(container.querySelectorAll(".day-bar")).toHaveLength(1);
  });

  it("scales a bar against the target", () => {
    const { container } = render(
      <WeekChart start={MONDAY} entries={entries([MONDAY, 4 * HOUR])} />,
    );

    // Half a day against an eight-hour target.
    expect(
      (container.querySelector(".day-bar") as HTMLElement).style.height,
    ).toBe("50%");
  });

  it("names each day and its time in the column tooltip", () => {
    const { container } = render(
      <WeekChart start={MONDAY} entries={entries([MONDAY, 90 * 60])} />,
    );

    const first = container.querySelector(".day-col");
    expect(first?.getAttribute("title")).toMatch(/· 1h 30m$/);
  });

  it("marks today among the labels", () => {
    // 18 March 2026 is the Wednesday of this week.
    const { container } = render(<WeekChart start={MONDAY} entries={[]} />);

    const today = container.querySelectorAll(".day-labels .today");
    expect(today).toHaveLength(1);
  });

  it("shows the weekend when a weekend day was worked", () => {
    const { container } = render(
      <WeekChart start={MONDAY} entries={entries(["2026-03-21", HOUR])} />,
    );

    expect(container.querySelectorAll(".day-col")).toHaveLength(6);
  });
});

describe("the week gauge", () => {
  it("reads zero for a week with nothing logged", () => {
    render(<WeekChart start={MONDAY} entries={[]} />);

    expect(screen.getByText("0%")).toBeDefined();
    expect(screen.getByText("of 40h")).toBeDefined();
  });

  it("reads the fraction of the weekly target", () => {
    render(
      <WeekChart
        start={MONDAY}
        entries={entries([MONDAY, 8 * HOUR], ["2026-03-17", 8 * HOUR])}
      />,
    );

    // Two of five days.
    expect(screen.getByText("40%")).toBeDefined();
  });

  it("says how much of the target is done in its tooltip", () => {
    const { container } = render(
      <WeekChart start={MONDAY} entries={entries([MONDAY, 8 * HOUR])} />,
    );

    expect(container.querySelector(".week-gauge")?.getAttribute("title")).toBe(
      "8h of 40h",
    );
  });
});

describe("fun mode", () => {
  it("stays quiet while it is off", () => {
    const full = entries(
      [MONDAY, 8 * HOUR],
      ["2026-03-17", 8 * HOUR],
      ["2026-03-18", 8 * HOUR],
      ["2026-03-19", 8 * HOUR],
      ["2026-03-20", 8 * HOUR],
    );

    const { container } = render(<WeekChart start={MONDAY} entries={full} />);

    expect(container.querySelector(".week-rank")).toBeNull();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("shows a rank and records a full week when it is on", () => {
    setFunMode(true);
    const full = entries(
      [MONDAY, 8 * HOUR],
      ["2026-03-17", 8 * HOUR],
      ["2026-03-18", 8 * HOUR],
      ["2026-03-19", 8 * HOUR],
      ["2026-03-20", 8 * HOUR],
    );

    const { container } = render(<WeekChart start={MONDAY} entries={full} />);

    expect(container.querySelector(".week-rank")).not.toBeNull();
    expect(recordEvent).toHaveBeenCalledWith({ kind: "weekTargetReached" });
  });

  it("records nothing for a week that fell short", () => {
    setFunMode(true);

    render(<WeekChart start={MONDAY} entries={entries([MONDAY, HOUR])} />);

    expect(recordEvent).not.toHaveBeenCalled();
  });
});
