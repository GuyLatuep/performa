import { describe, expect, it } from "vitest";
import { priorityClass, priorityRank, shortStatus } from "./issueLabels";

describe("shortStatus", () => {
  it("collapses the waiting-on-somebody-else statuses", () => {
    expect(shortStatus("Waiting for CTS")).toBe("Warten");
    expect(shortStatus("warte auf Support")).toBe("Warten");
    expect(shortStatus(" warten auf Kunde")).toBe("Warten");
  });

  it("leaves every other status as it is", () => {
    expect(shortStatus("In Progress")).toBe("In Progress");
    // Not a prefix match: the status is about waiting, not waiting on anyone.
    expect(shortStatus("Awaiting release")).toBe("Awaiting release");
  });
});

describe("priorityRank", () => {
  it("ranks the two ends of the scale and shares the middle", () => {
    expect(priorityRank("Highest")).toBe(0);
    expect(priorityRank("Kritisch")).toBe(0);
    expect(priorityRank("High")).toBe(1);
    expect(priorityRank("Medium")).toBe(2);
    // A site's own name for something in between is neither urgent nor low.
    expect(priorityRank("Standard")).toBe(2);
    expect(priorityRank("Niedrig")).toBe(3);
  });
});

describe("priorityClass", () => {
  it("colours only the ends", () => {
    expect(priorityClass("Blocker")).toBe("urgent");
    expect(priorityClass("Hoch")).toBe("high");
    expect(priorityClass("Medium")).toBe("");
    expect(priorityClass("Lowest")).toBe("low");
  });
});
