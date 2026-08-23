import { createStore } from "./store";

// Which site-specific fields the issue view shows.
//
// These are field *names* as the site spells them ("Plant-No.", "Remote
// Access"), not the opaque `customfield_NNNNN` ids — names are what a person
// recognises, and the backend resolves them through the site's own catalog. A
// name that no longer exists simply stops appearing rather than breaking the
// view, which is what makes it safe to keep a stale one around.
//
// Shipped with the fields this app was built for, so an existing install sees
// what it saw before; every one of them can be removed.

const KEY = "performa-issue-fields";

/** Bumped when the shape changes in a way a stored value has to be brought
 *  forward from. Absent means the first version, which held only the
 *  site-specific fields because the standard ones were hardcoded in the view. */
const VERSION = 2;

/** The fields every Jira has, under the names Jira gives them. Shipped as the
 *  head of the default order — the layout the app has always had — but no
 *  longer fixed there: they reorder and hide like any other. */
export const STANDARD_FIELD_NAMES = [
  "Issue Type",
  "Priority",
  "Reporter",
  "Assignee",
  "Due date",
];

/** The site's own fields the issue view shows, in display order.
 *
 *  Only which fields are *shown* is configured. Which can be *changed* is not:
 *  that is a property of the issue's own edit form, which varies by issue type
 *  and permission, so the view asks Jira instead. */
export interface IssueFieldConfig {
  /** Every field the issue view shows, in display order — the standard ones
   *  and the site's own alike. */
  detail: string[];
  /** Of those, the ones shown full width below the grid rather than in a cell.
   *  Long prose — an analysis, a bug summary — is unreadable in a 190px column,
   *  and which fields hold prose is a property of the site, not of one issue's
   *  value. */
  wide: string[];
}

export const DEFAULT_FIELD_CONFIG: IssueFieldConfig = {
  detail: [
    ...STANDARD_FIELD_NAMES,
    "Plant-No.",
    "Plant name",
    "Plant location",
    "Analyseergebnis 1st Level",
    "Responsible 1st Level",
    "Remote Access",
    "System type",
  ],
  wide: [],
};

/** Trimmed and deduped case-insensitively, order preserved — the order is the
 *  display order, so it is the one thing that must not be sorted away. */
function normalize(config: IssueFieldConfig): IssueFieldConfig {
  const seen = new Set<string>();
  const detail: string[] = [];
  for (const raw of config.detail) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    detail.push(name);
  }
  // Only a shown field can be wide; a stale entry would otherwise linger
  // invisibly and reappear if the field were added back.
  const shown = new Set(detail.map((n) => n.toLowerCase()));
  const wide = [...new Set(config.wide.map((n) => n.trim().toLowerCase()))]
    .filter((n) => shown.has(n))
    .map((n) => detail.find((d) => d.toLowerCase() === n)!);
  return { detail, wide };
}

function read(): IssueFieldConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return normalize(DEFAULT_FIELD_CONFIG);
    const candidate = raw as Partial<IssueFieldConfig> & { version?: number };
    // A config written before the standard fields were configurable lists only
    // the site's own. Left alone it would now hide Type, Priority and the rest
    // entirely — so they go back at the front, where they were.
    const stored = Array.isArray(candidate.detail)
      ? candidate.detail.filter((n): n is string => typeof n === "string")
      : DEFAULT_FIELD_CONFIG.detail;
    const detail =
      candidate.version === VERSION
        ? stored
        : [...STANDARD_FIELD_NAMES, ...stored];
    return normalize({
      detail,
      wide: Array.isArray(candidate.wide)
        ? candidate.wide.filter((n): n is string => typeof n === "string")
        : [],
    });
  } catch {
    return normalize(DEFAULT_FIELD_CONFIG);
  }
}

const store = createStore<IssueFieldConfig>(read());

function save(config: IssueFieldConfig): void {
  const next = normalize(config);
  localStorage.setItem(KEY, JSON.stringify({ ...next, version: VERSION }));
  // Always a fresh object — the store compares with Object.is.
  store.set(next);
}

export function getIssueFieldConfig(): IssueFieldConfig {
  return store.get();
}

export function useIssueFieldConfig(): IssueFieldConfig {
  return store.use();
}

export function addDetailField(name: string): void {
  const current = store.get();
  save({ ...current, detail: [...current.detail, name] });
}

export function removeDetailField(name: string): void {
  const current = store.get();
  save({
    ...current,
    detail: current.detail.filter(
      (n) => n.toLowerCase() !== name.trim().toLowerCase(),
    ),
  });
}

/** Move one field up or down the display order. Out-of-range moves are no-ops
 *  rather than errors: the buttons at the ends of the list would otherwise
 *  need to know about the list. */
export function moveDetailField(name: string, by: -1 | 1): void {
  const current = store.get();
  const from = current.detail.findIndex(
    (n) => n.toLowerCase() === name.trim().toLowerCase(),
  );
  const to = from + by;
  if (from < 0 || to < 0 || to >= current.detail.length) return;
  const detail = [...current.detail];
  [detail[from], detail[to]] = [detail[to], detail[from]];
  save({ ...current, detail });
}

/** Show one field full width, or put it back in the grid. */
export function toggleWideField(name: string): void {
  const current = store.get();
  const key = name.trim().toLowerCase();
  save({
    ...current,
    wide: current.wide.some((n) => n.toLowerCase() === key)
      ? current.wide.filter((n) => n.toLowerCase() !== key)
      : [...current.wide, name],
  });
}

export function isWideField(config: IssueFieldConfig, name: string): boolean {
  const key = name.trim().toLowerCase();
  return config.wide.some((n) => n.toLowerCase() === key);
}
