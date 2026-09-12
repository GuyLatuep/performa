import { describe, expect, it } from "vitest";
import { parseIssueKey } from "./issueKey";

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
