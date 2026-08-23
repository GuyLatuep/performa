/**
 * A title for the week so far, from hours logged against the weekly target.
 *
 * Thresholds are fractions of the target rather than fixed hours: somebody on
 * a four-hour day should reach the top of the ladder by filling their own
 * week, not by filling somebody else's.
 */
const RANKS: { at: number; title: string }[] = [
  { at: 0, title: "Zeiterfassungs-Lehrling" },
  { at: 0.25, title: "Buchungsgeselle" },
  { at: 0.5, title: "Zeitmeister" },
  { at: 0.75, title: "Erfassungs-Veteran" },
  { at: 1, title: "Grossmeister der Buchung" },
];

/** The title earned by `logged` seconds against a `target` of them. */
export function rankFor(logged: number, target: number): string {
  // A target of zero would make every fraction infinite; nobody has logged
  // their way past a week that asks for nothing.
  if (!Number.isFinite(logged) || !Number.isFinite(target) || target <= 0)
    return RANKS[0].title;
  const share = Math.max(0, logged) / target;
  // Last one whose threshold has been passed — the list is in order.
  return RANKS.reduce(
    (best, rank) => (share >= rank.at ? rank.title : best),
    RANKS[0].title,
  );
}

/** How far into the current rank, 0–1, for anything that wants to draw it. */
export function rankProgress(logged: number, target: number): number {
  if (!Number.isFinite(logged) || !Number.isFinite(target) || target <= 0)
    return 0;
  return Math.min(1, Math.max(0, logged) / target);
}
