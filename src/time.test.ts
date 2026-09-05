import { describe, expect, it, vi } from "vitest";
import {
  eachDate,
  formatDayLabel,
  formatDuration,
  isWeekend,
  monthLabel,
  monthRange,
  parseDuration,
  startOfWeek,
  timeAgo,
  toDateInput,
  weekChunks,
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

describe("monthRange", () => {
  it("spans the first to the last of the current month", () => {
    withSystemTime(new Date(2026, 7, 17, 14, 30), () => {
      expect(monthRange(0)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    });
  });

  it("counts backwards across a year boundary", () => {
    withSystemTime(new Date(2026, 0, 15), () => {
      expect(monthRange(-1)).toEqual({
        start: "2025-12-01",
        end: "2025-12-31",
      });
      expect(monthRange(-13)).toEqual({
        start: "2024-12-01",
        end: "2024-12-31",
      });
    });
  });

  // Regression: shifting *today's* date back a month lands 31 March on
  // 31 February, which JavaScript rolls forward into March — so the "previous
  // month" of the 31st was the same month again.
  it("steps back from a 31st into the shorter month before it", () => {
    withSystemTime(new Date(2026, 2, 31), () => {
      expect(monthRange(-1)).toEqual({
        start: "2026-02-01",
        end: "2026-02-28",
      });
    });
  });

  it("knows a leap February", () => {
    withSystemTime(new Date(2028, 1, 10), () => {
      expect(monthRange(0).end).toBe("2028-02-29");
    });
  });
});

describe("eachDate", () => {
  it("includes both ends", () => {
    expect(eachDate("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(eachDate("2026-08-01", "2026-08-01")).toEqual(["2026-08-01"]);
  });

  it("counts the days of a month, whatever its length", () => {
    expect(eachDate("2026-02-01", "2026-02-28")).toHaveLength(28);
    expect(eachDate("2028-02-01", "2028-02-29")).toHaveLength(29);
    expect(eachDate("2026-04-01", "2026-04-30")).toHaveLength(30);
    expect(eachDate("2026-08-01", "2026-08-31")).toHaveLength(31);
  });

  // Regression: stepping by 86_400_000ms instead of setDate turns the 23-hour
  // day into a repeat of the day before, so March came back with 32 entries.
  it("survives both daylight-saving transitions", () => {
    withTimeZone("Europe/Berlin", () => {
      expect(eachDate("2026-03-01", "2026-03-31")).toHaveLength(31);
      expect(eachDate("2026-10-01", "2026-10-31")).toHaveLength(31);
    });
  });
});

describe("isWeekend", () => {
  it("is the two days nobody is expected to book", () => {
    expect(isWeekend("2026-08-15")).toBe(true); // Sat
    expect(isWeekend("2026-08-16")).toBe(true); // Sun
    expect(isWeekend("2026-08-17")).toBe(false); // Mon
    expect(isWeekend("2026-08-21")).toBe(false); // Fri
  });
});

describe("monthLabel", () => {
  it("names the month and the year", () => {
    expect(monthLabel("2026-08-01")).toMatch(/2026/);
  });
});

describe("weekChunks", () => {
  it("covers the range with Monday-aligned weeks", () => {
    // August 2026 starts on a Saturday, so the first chunk reaches back into
    // July — the overrun callers are expected to filter away.
    const chunks = weekChunks("2026-08-01", "2026-08-31");
    expect(chunks[0].start).toBe("2026-07-27");
    expect(chunks[chunks.length - 1].end).toBe("2026-09-06");
    for (const { start, end } of chunks) {
      expect(startOfWeek(new Date(start + "T00:00:00"))).toBe(start);
      expect(eachDate(start, end)).toHaveLength(7);
    }
  });

  it("starts on the range itself when that is already a Monday", () => {
    // June 2026 starts on a Monday and has 30 days: five whole weeks.
    const chunks = weekChunks("2026-06-01", "2026-06-30");
    expect(chunks[0].start).toBe("2026-06-01");
    expect(chunks).toHaveLength(5);
  });

  it("leaves no day of the range uncovered", () => {
    const covered = new Set(
      weekChunks("2026-08-01", "2026-08-31").flatMap((c) =>
        eachDate(c.start, c.end),
      ),
    );
    for (const date of eachDate("2026-08-01", "2026-08-31"))
      expect(covered.has(date)).toBe(true);
  });
});

/** Run `body` with the clock pinned — the month helpers are all relative to
 *  "now", so the suite cannot be at the mercy of the day it runs on. */
function withSystemTime(at: Date, body: () => void): void {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  try {
    body();
  } finally {
    vi.useRealTimers();
  }
}

describe("formatDayLabel", () => {
  // A fixed Sunday, so "today" and "not today" are both unambiguous.
  const NOON = new Date(2026, 2, 15, 12, 0, 0);

  it("marks the current day and leaves every other day unmarked", () => {
    withSystemTime(NOON, () => {
      expect(formatDayLabel("2026-03-15", { weekday: "short" })).toMatch(
        / · Today$/,
      );
      expect(formatDayLabel("2026-03-14", { weekday: "short" })).not.toMatch(
        /Today/,
      );
    });
  });

  it("reads the date as local midnight, not UTC", () => {
    // The bug this guards against only shows west of Greenwich, where a bare
    // "yyyy-MM-dd" parses as UTC and renders as the day before. CI runs the
    // suite in America/Los_Angeles for exactly this reason.
    withSystemTime(NOON, () => {
      const local = new Date(2026, 2, 14).toLocaleDateString(undefined, {
        weekday: "short",
      });
      expect(formatDayLabel("2026-03-14", { weekday: "short" })).toBe(local);
    });
  });

  it("passes the caller's options through", () => {
    withSystemTime(NOON, () => {
      const dayOnly = formatDayLabel("2026-03-14", { day: "numeric" });
      const withMonth = formatDayLabel("2026-03-14", {
        day: "numeric",
        month: "long",
      });
      expect(withMonth.length).toBeGreaterThan(dayOnly.length);
    });
  });
});

describe("timeAgo", () => {
  const NOW = new Date(2026, 2, 15, 12, 0, 0);

  /** `iso` for a moment `minutes` before NOW. */
  function agoBy(minutes: number): string {
    return new Date(NOW.getTime() - minutes * 60_000).toISOString();
  }

  it("counts minutes below an hour", () => {
    withSystemTime(NOW, () => {
      expect(timeAgo(agoBy(0))).toBe("0m ago");
      expect(timeAgo(agoBy(5))).toBe("5m ago");
      expect(timeAgo(agoBy(59))).toBe("59m ago");
    });
  });

  it("switches to hours, then to days", () => {
    withSystemTime(NOW, () => {
      expect(timeAgo(agoBy(60))).toBe("1h ago");
      expect(timeAgo(agoBy(23 * 60))).toBe("23h ago");
      expect(timeAgo(agoBy(24 * 60))).toBe("1d ago");
      expect(timeAgo(agoBy(10 * 24 * 60))).toBe("10d ago");
    });
  });

  it("never counts backwards for a timestamp in the future", () => {
    // Clock skew between Jira and this machine is enough to produce one, and
    // "-3m ago" would be a visible bug rather than a harmless oddity.
    withSystemTime(NOW, () => {
      expect(timeAgo(agoBy(-30))).toBe("0m ago");
    });
  });
});
