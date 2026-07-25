import { describe, expect, it, vi } from "vitest";
import { formatClock, roundUpToQuarterHour } from "./timer";

const KEY = "performa-active-timer";

async function freshTimer(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(KEY, JSON.stringify(seed));
  vi.resetModules();
  return import("./timer");
}

describe("roundUpToQuarterHour", () => {
  it("rounds up to the next quarter, with a 15 minute floor", () => {
    expect(roundUpToQuarterHour(0)).toBe(900);
    expect(roundUpToQuarterHour(1)).toBe(900);
    expect(roundUpToQuarterHour(900)).toBe(900);
    expect(roundUpToQuarterHour(901)).toBe(1800);
    expect(roundUpToQuarterHour(3600)).toBe(3600);
    expect(roundUpToQuarterHour(3601)).toBe(4500);
  });
});

describe("formatClock", () => {
  it("switches to hours only past the hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(95)).toBe("01:35");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  it("matches the Rust tray formatter", () => {
    // src-tauri/src/tray.rs renders the same clock next to the menu bar icon;
    // these are the exact cases its `clock_formats` test asserts.
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(95)).toBe("01:35");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("active timer", () => {
  it("persists a started timer and clears it on stop", async () => {
    const { startTimer, stopTimer, getTimer } = await freshTimer();

    startTimer("ABC-1", "Fix the thing");

    const running = getTimer();
    expect(running?.issueKey).toBe("ABC-1");
    expect(running?.issueSummary).toBe("Fix the thing");
    expect(running?.startedAt).toBeTypeOf("number");
    expect(localStorage.getItem(KEY)).not.toBeNull();

    stopTimer();

    expect(getTimer()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("restores a timer left running by a previous session", async () => {
    // Elapsed time is derived from the stored start, so closing the app with a
    // timer running must not lose it.
    const startedAt = Date.now() - 5000;
    const { getTimer } = await freshTimer({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      startedAt,
    });

    expect(getTimer()).toEqual({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      startedAt,
    });
  });

  it("ignores malformed or incomplete stored timers", async () => {
    const junk = [
      "not json",
      { issueKey: "ABC-3" }, // no startedAt — elapsed would be NaN
      { startedAt: 1 }, // no issue to log against
      { issueKey: "ABC-3", startedAt: "soon" },
    ];
    for (const seed of junk) {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        typeof seed === "string" ? seed : JSON.stringify(seed),
      );
      vi.resetModules();
      const { getTimer } = await import("./timer");
      expect(getTimer()).toBeNull();
    }
  });
});
