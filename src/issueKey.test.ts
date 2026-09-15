import { describe, expect, it } from "vitest";
import { parseIssueKey, splitIssueKeys } from "./issueKey";

// Mirrors `jira::is_issue_key` on the Rust side. Where these two disagree, the
// palette offers a key the backend then refuses — so the cases below are the
// same cases that function draws.

describe("parseIssueKey", () => {
  it.each([
    ["a three-letter project", "ABC-1", "ABC-1"],
    ["a two-letter one, the shortest Jira allows", "AB-7", "AB-7"],
    ["a long one", "PERFORMA-1234", "PERFORMA-1234"],
    ["digits in the project, after the first character", "A1B-9", "A1B-9"],
    ["surrounding space, which is just typing", "  ABC-1  ", "ABC-1"],
  ])("reads %s", (_label, typed, expected) => {
    expect(parseIssueKey(typed)).toBe(expected);
  });

  it.each([
    ["lower case, as anybody would type it", "abc-1", "ABC-1"],
    ["mixed case", "aBc-12", "ABC-12"],
  ])("upper-cases %s, which is how Jira writes them", (_label, typed, out) => {
    expect(parseIssueKey(typed)).toBe(out);
  });

  it.each([
    ["a bare word", "refresh"],
    ["a one-letter project, which Jira has none of", "A-1"],
    ["no project at all", "-1"],
    ["no number", "ABC-"],
    ["a number that is not one", "ABC-1a"],
    ["a project starting with a digit", "1BC-1"],
    ["punctuation in the project", "A.C-1"],
    ["no hyphen", "ABC1"],
    ["nothing", ""],
    ["only space", "   "],
    ["two hyphens, the second spoiling the number", "ABC-1-2"],
  ])("is nothing for %s", (_label, typed) => {
    expect(parseIssueKey(typed)).toBeNull();
  });

  it("takes the first hyphen, so a hyphenated project still reads", () => {
    // "AB-CD-1" splits at the first hyphen, leaving "CD-1" as the number, which
    // it is not. Jira has no such key either, so refusing it is right.
    expect(parseIssueKey("AB-CD-1")).toBeNull();
  });
});

// The same rule, run over a sentence: what a reminder's comment says about
// another issue is the context the reader wants, and the key in it is the way
// to reach that issue.
describe("splitIssueKeys", () => {
  it("leaves prose without a key in one piece", () => {
    expect(splitIssueKeys("waiting on the customer")).toEqual([
      { text: "waiting on the customer" },
    ]);
  });

  it("marks a key inside a sentence, keeping the text around it", () => {
    expect(splitIssueKeys("handled under DEV-12124 instead")).toEqual([
      { text: "handled under " },
      { text: "DEV-12124", key: "DEV-12124" },
      { text: " instead" },
    ]);
  });

  it("finds every key, not just the first", () => {
    expect(
      splitIssueKeys("CTS-8439 and DEV-12124").filter((s) => s.key),
    ).toEqual([
      { text: "CTS-8439", key: "CTS-8439" },
      { text: "DEV-12124", key: "DEV-12124" },
    ]);
  });

  it("upper-cases what it found, as Jira writes it", () => {
    expect(splitIssueKeys("see dev-7")).toEqual([
      { text: "see " },
      { text: "dev-7", key: "DEV-7" },
    ]);
  });

  it("adds no empty run around a key at either end", () => {
    expect(splitIssueKeys("ABC-1")).toEqual([{ text: "ABC-1", key: "ABC-1" }]);
  });

  it.each([
    ["a hyphenated word whose tail only looks like one", "MASCHINE-ABC-12"],
    ["a one-letter project, which Jira has none of", "see A-1 there"],
    ["a number that carries on past a hyphen", "see ABC-1-2 there"],
    ["a project starting with a digit", "see 1BC-1 there"],
    ["no hyphen", "see ABC1 there"],
  ])("finds no key in %s", (_label, text) => {
    expect(splitIssueKeys(text).some((s) => s.key)).toBe(false);
  });

  it("does not read a key out of the middle of a longer one", () => {
    // "ABC-12" holds "BC-1" if the boundaries are not checked, and following
    // that link would open an issue the comment never mentioned.
    expect(splitIssueKeys("ABC-12")).toEqual([
      { text: "ABC-12", key: "ABC-12" },
    ]);
  });

  it("is nothing at all for empty text", () => {
    expect(splitIssueKeys("")).toEqual([]);
  });
});
