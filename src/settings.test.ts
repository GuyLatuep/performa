import { describe, expect, it, vi } from "vitest";

const HOURS_KEY = "performa-daily-hours";
const LOG_LEVEL_KEY = "performa-log-level";

/** Fresh module over a seeded storage — the stores read it once at import. */
async function freshSettings(seed: Record<string, string> = {}) {
  localStorage.clear();
  for (const [key, value] of Object.entries(seed)) {
    localStorage.setItem(key, value);
  }
  vi.resetModules();
  return import("./settings");
}

describe("daily hours", () => {
  it("round-trips a valid value", async () => {
    const { setDailyHours, getDailyHours } = await freshSettings();

    setDailyHours(7.5);

    expect(getDailyHours()).toBe(7.5);
    expect(localStorage.getItem(HOURS_KEY)).toBe("7.5");
  });

  it("rejects values outside a plausible working day", async () => {
    const { setDailyHours, getDailyHours } = await freshSettings();
    const before = getDailyHours();

    // The settings input is a number field the user can also type into, so
    // these all arrive in practice.
    for (const bad of [0, -1, 25, NaN, Infinity]) {
      setDailyHours(bad);
      expect(getDailyHours()).toBe(before);
    }
    expect(localStorage.getItem(HOURS_KEY)).toBeNull();
  });

  it("accepts the boundaries", async () => {
    const { setDailyHours, getDailyHours } = await freshSettings();

    setDailyHours(24);
    expect(getDailyHours()).toBe(24);

    setDailyHours(0.5);
    expect(getDailyHours()).toBe(0.5);
  });

  it("defaults to 8 hours when nothing usable is stored", async () => {
    for (const junk of ["", "abc", "0", "99"]) {
      const { getDailyHours } = await freshSettings({ [HOURS_KEY]: junk });
      expect(getDailyHours()).toBe(8);
    }
  });

  it("restores a stored value", async () => {
    const { getDailyHours } = await freshSettings({ [HOURS_KEY]: "6" });
    expect(getDailyHours()).toBe(6);
  });
});

describe("weekend toggle", () => {
  it("round-trips and defaults to off", async () => {
    const { getShowWeekends, setShowWeekends } = await freshSettings();
    expect(getShowWeekends()).toBe(false);

    setShowWeekends(true);
    expect(getShowWeekends()).toBe(true);

    const restored = await freshSettings({ "performa-show-weekends": "true" });
    expect(restored.getShowWeekends()).toBe(true);
  });
});

describe("log level", () => {
  it("defaults to error and round-trips a known level", async () => {
    const { getLogLevel, setLogLevel } = await freshSettings();
    expect(getLogLevel()).toBe("error");

    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
    expect(localStorage.getItem(LOG_LEVEL_KEY)).toBe("debug");
  });

  it("falls back to error for an unknown stored level", async () => {
    // e.g. a level removed in a later version, or a hand-edited value.
    const { getLogLevel } = await freshSettings({ [LOG_LEVEL_KEY]: "trace" });
    expect(getLogLevel()).toBe("error");
  });
});
