import { describe, expect, it } from "vitest";
import { IssueSummary } from "./api";
import { nextSort, sortIssues, TodoSort } from "./todoSort";

const issue = (key: string, fields: Partial<IssueSummary> = {}): IssueSummary =>
  ({ key, summary: key, ...fields }) as IssueSummary;

const keys = (issues: IssueSummary[]) => issues.map((i) => i.key);

describe("nextSort", () => {
  it("cycles a column through ascending, descending and off", () => {
    const first = nextSort(null, "key");
    expect(first).toEqual({ column: "key", direction: "asc" });

    const second = nextSort(first, "key");
    expect(second).toEqual({ column: "key", direction: "desc" });

    // Back to the order the query asked for, not a third ordering.
    expect(nextSort(second, "key")).toBeNull();
  });

  it("starts a different column over rather than inheriting the direction", () => {
    const sorted: TodoSort = { column: "key", direction: "desc" };
    expect(nextSort(sorted, "status")).toEqual({
      column: "status",
      direction: "asc",
    });
  });
});

describe("sortIssues", () => {
  it("hands back the same array when nothing is sorted on", () => {
    const issues = [issue("B-1"), issue("A-2")];
    expect(sortIssues(issues, null)).toBe(issues);
  });

  it("orders keys by project and then by number", () => {
    const issues = [issue("ABC-9"), issue("ABD-1"), issue("ABC-10")];
    const sorted = sortIssues(issues, { column: "key", direction: "asc" });
    // Not "ABC-10" before "ABC-9", which is what comparing them as text gives.
    expect(keys(sorted)).toEqual(["ABC-9", "ABC-10", "ABD-1"]);
  });

  it("orders priority by urgency, not alphabetically", () => {
    const issues = [
      issue("A-1", { priority: "Medium" }),
      issue("A-2", { priority: "Low" }),
      issue("A-3", { priority: "Highest" }),
      issue("A-4", { priority: "High" }),
    ];
    const sorted = sortIssues(issues, { column: "priority", direction: "asc" });
    expect(keys(sorted)).toEqual(["A-3", "A-4", "A-1", "A-2"]);
  });

  it("groups statuses by the label the badge shows", () => {
    const issues = [
      issue("A-1", { status: "Open" }),
      issue("A-2", { status: "Waiting for CTS" }),
      issue("A-3", { status: "Done" }),
      issue("A-4", { status: "warte auf Support" }),
    ];
    const sorted = sortIssues(issues, { column: "status", direction: "asc" });
    // Both "waiting" statuses read "Warten" on the row, so they sit together.
    expect(keys(sorted)).toEqual(["A-3", "A-1", "A-2", "A-4"]);
  });

  it("keeps issues with nothing in the column at the bottom either way", () => {
    const issues = [
      issue("A-1"),
      issue("A-2", { issueType: "Task" }),
      issue("A-3", { issueType: "Bug" }),
    ];
    expect(
      keys(sortIssues(issues, { column: "type", direction: "asc" })),
    ).toEqual(["A-3", "A-2", "A-1"]);
    expect(
      keys(sortIssues(issues, { column: "type", direction: "desc" })),
    ).toEqual(["A-2", "A-3", "A-1"]);
  });

  it("leaves ties in the order Jira sent them", () => {
    const issues = [
      issue("C-3", { status: "Open" }),
      issue("A-1", { status: "Open" }),
      issue("B-2", { status: "Open" }),
    ];
    const sorted = sortIssues(issues, { column: "status", direction: "asc" });
    expect(keys(sorted)).toEqual(["C-3", "A-1", "B-2"]);
  });

  it("does not reorder the array it was given", () => {
    const issues = [issue("B-1"), issue("A-1")];
    sortIssues(issues, { column: "key", direction: "asc" });
    expect(keys(issues)).toEqual(["B-1", "A-1"]);
  });
});
