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
 *  forward from.
 *
 *  1 (absent) held only the site-specific fields, the standard ones being
 *  hardcoded in the view. 2 added them to the list. 3 replaced the `wide`
 *  name list with per-field sizes. */
const VERSION = 3;

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
  /** How much room each field gets, keyed by its normalised name. A field with
   *  no entry is "normal" — most are, and storing that would be noise. */
  sizes: Record<string, FieldSize>;
}

/**
 * How much of the row a field occupies.
 *
 * - `normal` — one cell of the facts grid, which is what a word or two needs.
 * - `wide` — two cells, for a value that keeps wrapping in one.
 * - `full` — a row to itself, rendered as prose under its own heading. Long
 *   text is unreadable in a 190px column however many of them it spans.
 */
export type FieldSize = "normal" | "wide" | "full";

const SIZES: FieldSize[] = ["normal", "wide", "full"];

/** Compared without case, spaces or punctuation — the same rule the view and
 *  the Rust client match field names by. */
function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  sizes: {},
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
  // Only a shown field can carry a size; a stale entry would otherwise linger
  // invisibly and reappear if the field were added back. "normal" is the
  // default, so storing it would be noise.
  const shown = new Set(detail.map(key));
  const sizes: Record<string, FieldSize> = {};
  for (const [name, size] of Object.entries(config.sizes ?? {})) {
    const k = key(name);
    if (shown.has(k) && SIZES.includes(size) && size !== "normal")
      sizes[k] = size;
  }
  return { detail, sizes };
}

function read(): IssueFieldConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return normalize(DEFAULT_FIELD_CONFIG);
    const candidate = raw as Partial<IssueFieldConfig> & {
      version?: number;
      /** Version 2 and earlier: the names shown full width. */
      wide?: unknown;
    };
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
    // A layout somebody already arranged said "wide" for what is now "full" —
    // the size that renders as prose. Carrying it over is the whole point of
    // the version bump.
    const migrated: Record<string, FieldSize> = {};
    if (Array.isArray(candidate.wide))
      for (const name of candidate.wide)
        if (typeof name === "string") migrated[key(name)] = "full";

    return normalize({
      detail,
      sizes:
        candidate.version === VERSION && candidate.sizes
          ? candidate.sizes
          : migrated,
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

/** How much room a field gets. */
export function fieldSize(config: IssueFieldConfig, name: string): FieldSize {
  return config.sizes[key(name)] ?? "normal";
}

export function setFieldSize(name: string, size: FieldSize): void {
  const current = store.get();
  save({ ...current, sizes: { ...current.sizes, [key(name)]: size } });
}

/** The next size in the cycle, so one control can walk all three. */
export function nextFieldSize(size: FieldSize): FieldSize {
  return SIZES[(SIZES.indexOf(size) + 1) % SIZES.length];
}

/**
 * Move a field to an absolute position, as dropping it somewhere means.
 *
 * `toIndex` is read against the list *without* the dragged field, which is
 * what a drop target describes: "put it before the field currently here".
 * Out-of-range indices clamp rather than throw — a drop past the end of the
 * grid is a drop at the end.
 */
export function reorderDetailField(name: string, toIndex: number): void {
  const current = store.get();
  const from = current.detail.findIndex((n) => key(n) === key(name));
  if (from < 0) return;
  const rest = current.detail.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  rest.splice(at, 0, current.detail[from]);
  save({ ...current, detail: rest });
}
