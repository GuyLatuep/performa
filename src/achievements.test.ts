import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  AchievementState,
  award,
  EMPTY_STATE,
  isMilestoneLog,
  nextStreak,
} from "./achievements";

function state(over: Partial<AchievementState> = {}): AchievementState {
  return { ...EMPTY_STATE, ...over };
}

/** A worklog on a day, at an hour. */
function logged(date: string, time = "12:00") {
  return { kind: "logged" as const, date, time };
}

describe("nextStreak", () => {
  it("starts at one", () => {
    expect(nextStreak("", 0, "2026-08-24")).toBe(1);
  });

  it("continues from yesterday", () => {
    expect(nextStreak("2026-08-23", 4, "2026-08-24")).toBe(5);
  });

  it("does not extend for a second log the same day", () => {
    expect(nextStreak("2026-08-24", 4, "2026-08-24")).toBe(4);
  });

  it("restarts after a gap", () => {
    expect(nextStreak("2026-08-20", 9, "2026-08-24")).toBe(1);
  });

  it("counts days, not hours", () => {
    // Subtracting timestamps would let a daylight-saving hour break a streak.
    expect(nextStreak("2026-03-28", 2, "2026-03-29")).toBe(3);
    expect(nextStreak("2026-10-24", 2, "2026-10-25")).toBe(3);
  });

  it("restarts across a month and a year boundary", () => {
    expect(nextStreak("2026-08-31", 3, "2026-09-01")).toBe(4);
    expect(nextStreak("2026-12-31", 3, "2027-01-01")).toBe(4);
  });

  it("leaves the streak alone without a date", () => {
    expect(nextStreak("2026-08-23", 4, "")).toBe(4);
  });
});

describe("award", () => {
  it("gives the first worklog its award", () => {
    const { earned } = award(state(), logged("2026-08-24"));
    expect(earned).toContain("erste-buchung");
  });

  it("never gives the same award twice", () => {
    const first = award(state(), logged("2026-08-24"));
    const second = award(first.state, logged("2026-08-25"));
    expect(second.earned).not.toContain("erste-buchung");
  });

  it("counts every worklog even when nothing is earned", () => {
    const first = award(state(), logged("2026-08-24"));
    const second = award(first.state, logged("2026-08-24"));
    expect(second.state.loggedCount).toBe(2);
    expect(second.earned).toEqual([]);
  });

  it("awards the streaks as they are reached", () => {
    let s = state();
    const days = [
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
      "2026-08-24",
    ];
    const all: string[] = [];
    for (const day of days) {
      const r = award(s, logged(day));
      s = r.state;
      all.push(...r.earned);
    }
    expect(all).toContain("drei-tage");
    expect(all).toContain("fuenf-tage");
    expect(s.streak).toBe(5);
  });

  it("reads the hour from the worklog, not the clock", () => {
    expect(award(state(), logged("2026-08-24", "07:30")).earned).toContain(
      "fruehaufsteher",
    );
    expect(award(state(), logged("2026-08-24", "19:00")).earned).toContain(
      "nachtschicht",
    );
  });

  it("puts the late boundary at 18:00", () => {
    expect(award(state(), logged("2026-08-24", "17:59")).earned).not.toContain(
      "nachtschicht",
    );
    expect(award(state(), logged("2026-08-24", "18:00")).earned).toContain(
      "nachtschicht",
    );
  });

  it("puts the early boundary at 08:00", () => {
    expect(award(state(), logged("2026-08-24", "07:59")).earned).toContain(
      "fruehaufsteher",
    );
    expect(award(state(), logged("2026-08-24", "08:00")).earned).not.toContain(
      "fruehaufsteher",
    );
  });

  it("awards the one-offs for their own events", () => {
    expect(award(state(), { kind: "commented" }).earned).toEqual([
      "erster-kommentar",
    ]);
    expect(award(state(), { kind: "transitioned" }).earned).toEqual([
      "erster-statuswechsel",
    ]);
    expect(award(state(), { kind: "weekTargetReached" }).earned).toEqual([
      "woche-voll",
    ]);
    expect(award(state(), { kind: "mentionsEmpty" }).earned).toEqual([
      "posteingang-leer",
    ]);
    expect(award(state(), { kind: "missingEmpty" }).earned).toEqual([
      "nichts-vergessen",
    ]);
  });

  it("does not mutate the state it was given", () => {
    const before = state();
    award(before, logged("2026-08-24"));
    expect(before).toEqual(EMPTY_STATE);
  });

  it("every id it can award has a title", () => {
    // A missing title would toast an empty box.
    const events = [
      logged("2026-08-24", "07:00"),
      { kind: "commented" as const },
      { kind: "transitioned" as const },
      { kind: "weekTargetReached" as const },
      { kind: "mentionsEmpty" as const },
      { kind: "missingEmpty" as const },
    ];
    for (const event of events)
      for (const id of award(state(), event).earned)
        expect(ACHIEVEMENTS[id]).toBeTruthy();
  });
});

describe("isMilestoneLog", () => {
  it("is every tenth", () => {
    expect(isMilestoneLog(10)).toBe(true);
    expect(isMilestoneLog(20)).toBe(true);
    expect(isMilestoneLog(9)).toBe(false);
    expect(isMilestoneLog(11)).toBe(false);
  });

  it("is not the zeroth", () => {
    expect(isMilestoneLog(0)).toBe(false);
  });
});
