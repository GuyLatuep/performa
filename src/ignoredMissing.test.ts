import { describe, expect, it, vi } from "vitest";
import { MissingWorklog } from "./api";

const STORAGE_KEY = "performa-missing-ignored";
const HOUR = 60 * 60 * 1000;

/** Fresh module over a seeded storage — the store reads it once at import, and
 *  that read is also the 24-hour cleanup, so every case has to re-import. */
async function fresh(seed?: string) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(STORAGE_KEY, seed);
  vi.resetModules();
  return import("./ignoredMissing");
}

const finding = (issueKey: string, activityAt: string): MissingWorklog => ({
  issueKey,
  issueSummary: "An issue",
  kind: "status",
  detail: "To Do → In Progress",
  activityAt,
  logKey: issueKey,
  logSummary: "An issue",
});

/** A timestamp `offsetMs` away from now. Everything here is relative to the
 *  real clock rather than a frozen one: the module reads `Date.now()` at import
 *  and again on every write, and pinning that down would mean faking timers
 *  around a dynamic import. */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("reading stored ignores", () => {
  it("starts empty when nothing is stored", async () => {
    const { getIgnoredMissing } = await fresh();
    expect(getIgnoredMissing()).toEqual({});
  });

  it.each([
    ["not json at all", "{oh no"],
    ["an array", "[1, 2]"],
    ["null", "null"],
  ])("falls back to nothing ignored for %s", async (_label, seed) => {
    const { getIgnoredMissing } = await fresh(seed);
    expect(getIgnoredMissing()).toEqual({});
  });

  it("drops entries whose timestamp is not a usable number", async () => {
    const good = Date.now() - HOUR;
    const { getIgnoredMissing } = await fresh(
      JSON.stringify({ "DEV-1": "yesterday", "DEV-2": good, "DEV-3": null }),
    );
    expect(getIgnoredMissing()).toEqual({ "DEV-2": good });
  });
});

describe("the 24-hour cleanup at start", () => {
  it("keeps an ignore younger than a day", async () => {
    const stored = Date.now() - 23 * HOUR;
    const { getIgnoredMissing } = await fresh(
      JSON.stringify({ "DEV-1": stored }),
    );
    expect(getIgnoredMissing()).toEqual({ "DEV-1": stored });
  });

  it("drops one older than a day, out of storage as well", async () => {
    const kept = Date.now() - HOUR;
    const { getIgnoredMissing } = await fresh(
      JSON.stringify({ "DEV-1": Date.now() - 25 * HOUR, "DEV-2": kept }),
    );

    expect(getIgnoredMissing()).toEqual({ "DEV-2": kept });
    // Not just filtered out of this session's copy — gone for good, so the map
    // stays the size of what is actually still in play.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "DEV-2": kept,
    });
  });
});

describe("isIgnored", () => {
  it("shows an issue nobody ignored", async () => {
    const { getIgnoredMissing, isIgnored } = await fresh();
    expect(isIgnored(getIgnoredMissing(), finding("DEV-1", at(0)))).toBe(false);
  });

  it("hides the activity the user waved away", async () => {
    const { getIgnoredMissing, ignoreIssue, isIgnored } = await fresh();
    ignoreIssue("DEV-1");

    const item = finding("DEV-1", at(-2 * HOUR));
    expect(isIgnored(getIgnoredMissing(), item)).toBe(true);
  });

  it("shows the issue again once it sees newer activity", async () => {
    // The whole point of storing a timestamp rather than a flag: the epic an
    // automation dragged along stays quiet, but real work on it comes back.
    const { getIgnoredMissing, ignoreIssue, isIgnored } = await fresh();
    ignoreIssue("DEV-1");

    const later = finding("DEV-1", at(HOUR));
    expect(isIgnored(getIgnoredMissing(), later)).toBe(false);
  });

  it("leaves the other issues alone", async () => {
    const { getIgnoredMissing, ignoreIssue, isIgnored } = await fresh();
    ignoreIssue("DEV-9");

    const item = finding("DEV-1", at(-2 * HOUR));
    expect(isIgnored(getIgnoredMissing(), item)).toBe(false);
  });

  it("hides a finding whose timestamp will not parse", async () => {
    // Fail closed: the user has dismissed this issue, and a row nobody can
    // date is the worse thing to put back on screen.
    const { getIgnoredMissing, ignoreIssue, isIgnored } = await fresh();
    ignoreIssue("DEV-1");

    expect(isIgnored(getIgnoredMissing(), finding("DEV-1", "whenever"))).toBe(
      true,
    );
  });
});

describe("writing", () => {
  it("round-trips an ignore through storage", async () => {
    const { getIgnoredMissing, ignoreIssue } = await fresh();
    const before = Date.now();

    ignoreIssue("DEV-1");

    const stored = getIgnoredMissing()["DEV-1"];
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "DEV-1": stored,
    });
  });

  it("clears every ignore at once", async () => {
    const { clearIgnoredMissing, getIgnoredMissing, ignoreIssue } =
      await fresh();
    ignoreIssue("DEV-1");
    ignoreIssue("DEV-2");

    clearIgnoredMissing();

    expect(getIgnoredMissing()).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{}");
  });
});
