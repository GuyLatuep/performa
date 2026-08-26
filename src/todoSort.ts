import { IssueSummary } from "./api";
import { priorityRank, shortStatus } from "./issueLabels";

// Ordering the todo list by one of its columns.
//
// The list arrives in the order the backend's JQL asked for — most urgent
// first — and that order is worth being able to get back to, so a column cycles
// through three states rather than two: sorted one way, sorted the other, and
// off. Off is not a third ordering; it is Jira's, untouched.

export type SortColumn = "type" | "key" | "summary" | "priority" | "status";

export interface TodoSort {
  column: SortColumn;
  /** For everything but priority this is what it says. Priority ranks most
   *  urgent *first* when ascending: the arrow points at the top of the scale,
   *  which is the order somebody clicking "Prio" is asking for. */
  direction: "asc" | "desc";
}

/** What clicking `column` does to the current ordering: a new column starts
 *  ascending, the one already sorted turns around, and turning it around again
 *  drops back to the order the list came in. */
export function nextSort(
  current: TodoSort | null,
  column: SortColumn,
): TodoSort | null {
  if (current?.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/**
 * The issues in the asked-for order — the same array when nothing is asked
 * for, so the untouched case costs nothing.
 *
 * An issue missing the sorted-on field sinks to the bottom in both directions:
 * reversing an ordering should not bring a row with nothing to say to the top
 * of it.
 */
export function sortIssues(
  issues: IssueSummary[],
  sort: TodoSort | null,
): IssueSummary[] {
  if (!sort) return issues;
  const sign = sort.direction === "asc" ? 1 : -1;
  // Stable, so issues that tie on the sorted column keep the order Jira gave
  // them — a sort by status stays urgency-ordered within each status.
  return [...issues].sort((a, b) => {
    const missing = rankMissing(a, sort.column) - rankMissing(b, sort.column);
    if (missing !== 0) return missing;
    return sign * compare(a, b, sort.column);
  });
}

/** 1 for an issue with nothing in the sorted column, 0 otherwise. Direction
 *  never touches this, which is what keeps the blanks at the bottom. */
function rankMissing(issue: IssueSummary, column: SortColumn): number {
  return valueOf(issue, column) === undefined ? 1 : 0;
}

function valueOf(issue: IssueSummary, column: SortColumn): string | undefined {
  const raw =
    column === "type"
      ? issue.issueType
      : column === "key"
        ? issue.key
        : column === "summary"
          ? issue.summary
          : column === "priority"
            ? issue.priority
            : issue.status;
  return raw && raw.trim() !== "" ? raw : undefined;
}

function compare(a: IssueSummary, b: IssueSummary, column: SortColumn): number {
  const left = valueOf(a, column) ?? "";
  const right = valueOf(b, column) ?? "";
  if (column === "key") return compareKeys(left, right);
  if (column === "priority") return priorityRank(left) - priorityRank(right);
  // Status sorts by the label the badge shows, not the name behind it: two
  // statuses that both read "Warten" belong together in the column, which is
  // the only place this ordering is ever read.
  const shown = column === "status" ? shortStatus : (v: string) => v;
  return shown(left).localeCompare(shown(right), undefined, {
    sensitivity: "base",
  });
}

/** "ABC-9" before "ABC-10": an issue key is a project and a number, and
 *  comparing it as text puts the number in the wrong place as soon as a project
 *  passes its ninth issue. */
function compareKeys(a: string, b: string): number {
  const [, aProject = a, aNumber = ""] = /^(.*)-(\d+)$/.exec(a) ?? [];
  const [, bProject = b, bNumber = ""] = /^(.*)-(\d+)$/.exec(b) ?? [];
  const byProject = aProject.localeCompare(bProject, undefined, {
    sensitivity: "base",
  });
  if (byProject !== 0) return byProject;
  // Keys without a number on the end (there shouldn't be any, but a search can
  // return whatever Jira has) fall back to comparing what's left as text.
  if (aNumber === "" || bNumber === "") return a.localeCompare(b);
  return Number(aNumber) - Number(bNumber);
}
