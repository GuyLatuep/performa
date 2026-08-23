import {
  ActivityWorklog,
  IssueActivity,
  IssueComment,
  StatusChange,
} from "./api";

/**
 * One entry of an issue's timeline.
 *
 * The `kind` tag exists only here, at the display edge. Comments, status
 * changes and worklogs are three separate things everywhere else — in Jira, in
 * the Rust client, and in `IssueActivity` — and they are merged solely because
 * a person reading an issue wants its story in one column. See CONTEXT.md.
 */
export type TimelineEntry =
  | ({ kind: "comment" } & IssueComment)
  | ({ kind: "status" } & StatusChange)
  | ({ kind: "worklog" } & ActivityWorklog);

/**
 * Rank within one timestamp. Jira stamps a transition made together with a
 * comment at the same second, and without a tie-break the two would swap
 * places between renders. The order is a readability choice: the comment is
 * what the person actually said, the status change is context for it, and the
 * worklog is bookkeeping.
 */
const KIND_ORDER: Record<TimelineEntry["kind"], number> = {
  comment: 0,
  status: 1,
  worklog: 2,
};

/**
 * The three lists interleaved, newest first.
 *
 * Sorted on `createdTs` rather than the formatted stamp: Jira writes each
 * timestamp in the *reporter's* timezone, so two entries an hour apart can
 * order the wrong way round as strings. An entry whose timestamp Jira sent in
 * a shape we could not parse arrives as 0 and sinks to the bottom rather than
 * claiming to be the newest thing on the issue.
 */
export function timeline(activity: IssueActivity): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...activity.comments.map((c) => ({ kind: "comment" as const, ...c })),
    ...activity.statusChanges.map((s) => ({ kind: "status" as const, ...s })),
    ...activity.worklogs.map((w) => ({ kind: "worklog" as const, ...w })),
  ];
  return entries.sort(
    (a, b) =>
      b.createdTs - a.createdTs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

/** "Backlog → In Arbeit". Either end can be missing: Jira reports no previous
 *  status on the move out of creation, and a deleted status leaves a hole. */
export function statusChangeLabel(entry: StatusChange): string {
  return `${entry.from ?? "—"} → ${entry.to ?? "—"}`;
}
