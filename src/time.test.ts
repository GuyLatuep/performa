import { describe, expect, it, vi } from "vitest";
import {
  formatDuration,
  parseDuration,
  startOfWeek,
  toDateInput,
  weekRange,
} from "./time";

describe("parseDuration", () => {
  it("parses unit combinations", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("45m")).toBe(2700);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1d")).toBe(8 * 3600);
    expect(parseDuration("1w")).toBe(5 * 8 * 3600);
  });

  it("accepts decimals with dot or comma", () => {
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("0,25h")).toBe(900);
  });

  it("treats a bare number as hours", () => {
    expect(parseDuration("2")).toBe(7200);
    expect(parseDuration("0.5")).toBe(1800);
  });

  it("rejects garbage, empty, and non-positive input", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0m")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes compactly", () => {
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("carries rounded minutes into hours (3,590s is 1h, not 60m)", () => {
    expect(formatDuration(3590)).toBe("1h");
    expect(formatDuration(7170)).toBe("2h");
    expect(formatDuration(3629)).toBe("1h");
    expect(formatDuration(3631)).toBe("1h 1m");
  });
});

describe("week helpers", () => {
  it("startOfWeek returns the Monday of the containing week", () => {
    expect(startOfWeek(new Date("2026-07-16T12:00:00"))).toBe("2026-07-13"); // Thu
    expect(startOfWeek(new Date("2026-07-13T00:30:00"))).toBe("2026-07-13"); // Mon
    expect(startOfWeek(new Date("2026-07-19T23:00:00"))).toBe("2026-07-13"); // Sun
  });

  it("toDateInput zero-pads", () => {
    expect(toDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("weekRange spans Monday to Sunday", () => {
    expectMondayToSunday();
  });

  // Regression: a bare `new Date("yyyy-MM-dd")` parses as UTC midnight, which
  // put the range a day short everywhere west of Greenwich — invisible when
  // the suite happens to run in a positive-offset zone. Pinned to a western
  // zone so the developer's own timezone can't hide it again.
  it("weekRange spans Monday to Sunday west of Greenwich", () => {
    withTimeZone("America/Los_Angeles", expectMondayToSunday);
  });
});

function expectMondayToSunday(): void {
  const { start, end } = weekRange(0);
  expect(start).toBe(startOfWeek(new Date()));
  const endDate = new Date(end + "T00:00:00");
  expect((endDate.getDay() + 6) % 7).toBe(6); // Sunday
  expect(endDate.getTime() - new Date(start + "T00:00:00").getTime()).toBe(
    6 * 86_400_000,
  );
}

/** Run `body` with the process timezone temporarily switched. */
function withTimeZone(tz: string, body: () => void): void {
  vi.stubEnv("TZ", tz);
  try {
    body();
  } finally {
    vi.unstubAllEnvs();
  }
}
