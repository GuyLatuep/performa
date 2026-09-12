/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { ActionSpec, filterActions } from "./actions";

// The palette's own behaviour is covered in CommandPalette.test.tsx; this file is
// the ranking, which is what decides whether the thing you meant is the thing
// under the cursor.

const spec = (name: string, keywords?: string): ActionSpec => ({
  id: name,
  name,
  group: "g",
  keywords,
  run: vi.fn(),
});

const ACTIONS = [
  spec("Reply to customer"),
  spec("Refresh"),
  spec("Start tab"),
  spec("Open in Jira", "browser external"),
  spec("Switch to dark appearance", "theme colour"),
];

const names = (q: string) => filterActions(ACTIONS, q).map((a) => a.name);

describe("filterActions", () => {
  it("offers everything for an empty query", () => {
    expect(filterActions(ACTIONS, "").length).toBe(ACTIONS.length);
  });

  it("offers everything for whitespace, which is nothing typed", () => {
    expect(filterActions(ACTIONS, "   ").length).toBe(ACTIONS.length);
  });

  it("puts a name that starts with the query first", () => {
    // "re" should reach Refresh before Reply to customer, whatever order the
    // catalogue holds them in.
    expect(names("ref")[0]).toBe("Refresh");
  });

  it("ranks a name-prefix above a word-prefix", () => {
    expect(names("re")).toEqual(["Reply to customer", "Refresh"]);
  });

  it("finds a later word in the name", () => {
    expect(names("jira")).toEqual(["Open in Jira"]);
  });

  it("finds a word in the middle of one", () => {
    expect(names("ustom")).toEqual(["Reply to customer"]);
  });

  it("matches a keyword nobody sees", () => {
    expect(names("browser")).toEqual(["Open in Jira"]);
  });

  it("ranks a keyword match last, being the weakest reason", () => {
    // "Switch to dark appearance" carries "colour"; nothing else does.
    expect(names("colour")).toEqual(["Switch to dark appearance"]);
  });

  it("ignores case, in the query and in the name alike", () => {
    expect(names("REFRESH")).toEqual(["Refresh"]);
  });

  it("offers nothing for a query nothing matches", () => {
    expect(names("zzz")).toEqual([]);
  });

  it("ranks a word-prefix above a bare substring", () => {
    // "appearance" begins with the query; the other two merely contain it.
    expect(names("a")).toEqual([
      "Switch to dark appearance",
      "Start tab",
      "Open in Jira",
    ]);
  });

  it("keeps the catalogue's order within one rank", () => {
    // Four substring matches, no prefix among them, so nothing reorders.
    expect(names("e")).toEqual([
      "Reply to customer",
      "Refresh",
      "Open in Jira",
      "Switch to dark appearance",
    ]);
  });
});
