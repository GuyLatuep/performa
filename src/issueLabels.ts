// How an issue's status and priority read on a row: the short label a badge
// shows, and where a priority sits on the scale.
//
// Out of the row component because the todo tab's column sorting needs the same
// answers — an ordering by what the badges *say* is the only one that matches
// what the eye reads down the column.

/** Collapse the "somebody else has it" statuses ("warte auf Support",
 *  "Waiting for CTS", …) to one short label. Which party is waited on is in
 *  the badge's tooltip; keeping it out of the badge itself is what lets the
 *  status column stay narrow. Matched as a prefix so sibling statuses are
 *  covered too, rather than a list of names that goes stale. */
export function shortStatus(status: string): string {
  return /^(waiting for|warte[nt]? auf)\b/i.test(status.trim())
    ? "Warten"
    : status;
}

/** Where a priority sits on the scale, most urgent first — the order the todo
 *  tab sorts by, and what decides which end of it gets coloured.
 *
 *  Only the two ends are recognised: the names in between differ per Jira site
 *  and carry no urgency worth ranking apart, so they share the middle. Matched
 *  on the English and German defaults. */
export function priorityRank(priority: string): number {
  const p = priority.toLowerCase();
  if (/highest|blocker|critical|sehr hoch|kritisch/.test(p)) return 0;
  if (/^high|hoch/.test(p)) return 1;
  if (/lowest|^low|niedrig|gering/.test(p)) return 3;
  return 2;
}

/** The class that colours a priority badge — nothing for the middle of the
 *  scale, which is most of it. */
export function priorityClass(priority: string): string {
  return ["urgent", "high", "", "low"][priorityRank(priority)];
}
