import { describe, expect, it } from "vitest";
import { rankFor, rankProgress } from "./rank";

const WEEK = 40 * 3600;

describe("rankFor", () => {
  it("climbs the ladder as the week fills", () => {
    expect(rankFor(0, WEEK)).toBe("Zeiterfassungs-Lehrling");
    expect(rankFor(WEEK * 0.25, WEEK)).toBe("Buchungsgeselle");
    expect(rankFor(WEEK * 0.5, WEEK)).toBe("Zeitmeister");
    expect(rankFor(WEEK * 0.75, WEEK)).toBe("Erfassungs-Veteran");
    expect(rankFor(WEEK, WEEK)).toBe("Grossmeister der Buchung");
  });

  it("stays at the top once the target is passed", () => {
    expect(rankFor(WEEK * 3, WEEK)).toBe("Grossmeister der Buchung");
  });

  it("holds a rank until the next threshold", () => {
    expect(rankFor(WEEK * 0.49, WEEK)).toBe("Buchungsgeselle");
    expect(rankFor(WEEK * 0.99, WEEK)).toBe("Erfassungs-Veteran");
  });

  it("measures against the target, not against fixed hours", () => {
    // A four-hour day reaches the top by filling its own week.
    const shortWeek = 20 * 3600;
    expect(rankFor(shortWeek, shortWeek)).toBe("Grossmeister der Buchung");
    expect(rankFor(shortWeek, WEEK)).toBe("Zeitmeister");
  });

  it("does not promote anyone for a week that asks for nothing", () => {
    expect(rankFor(100, 0)).toBe("Zeiterfassungs-Lehrling");
    expect(rankFor(100, -1)).toBe("Zeiterfassungs-Lehrling");
    expect(rankFor(NaN, WEEK)).toBe("Zeiterfassungs-Lehrling");
  });

  it("treats negative time as none", () => {
    expect(rankFor(-500, WEEK)).toBe("Zeiterfassungs-Lehrling");
  });
});

describe("rankProgress", () => {
  it("is the share of the target, capped at one", () => {
    expect(rankProgress(WEEK / 2, WEEK)).toBe(0.5);
    expect(rankProgress(WEEK * 2, WEEK)).toBe(1);
    expect(rankProgress(0, WEEK)).toBe(0);
  });

  it("is zero when there is no target", () => {
    expect(rankProgress(100, 0)).toBe(0);
  });
});
