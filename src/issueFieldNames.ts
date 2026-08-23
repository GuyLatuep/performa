import { createStore } from "./store";

// Which site-specific fields the issue view shows, and which one it can
// change.
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

/** The fields the issue view shows, in display order, and the one it edits. */
export interface IssueFieldConfig {
  /** Read-only facts shown under the issue's standard fields. */
  detail: string[];
  /** The field the view offers to change. Empty means none is offered — the
   *  edit affordance disappears rather than pointing at nothing. */
  team: string;
}

export const DEFAULT_FIELD_CONFIG: IssueFieldConfig = {
  detail: [
    "Plant-No.",
    "Plant name",
    "Plant location",
    "Analyseergebnis 1st Level",
    "Responsible 1st Level",
    "Remote Access",
    "System type",
  ],
  team: "",
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
  return { detail, team: config.team.trim() };
}

function read(): IssueFieldConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return normalize(DEFAULT_FIELD_CONFIG);
    const candidate = raw as Partial<IssueFieldConfig>;
    return normalize({
      detail: Array.isArray(candidate.detail)
        ? candidate.detail.filter((n): n is string => typeof n === "string")
        : DEFAULT_FIELD_CONFIG.detail,
      team: typeof candidate.team === "string" ? candidate.team : "",
    });
  } catch {
    return normalize(DEFAULT_FIELD_CONFIG);
  }
}

const store = createStore<IssueFieldConfig>(read());

function save(config: IssueFieldConfig): void {
  const next = normalize(config);
  localStorage.setItem(KEY, JSON.stringify(next));
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

export function setTeamField(name: string): void {
  save({ ...store.get(), team: name });
}

/** Everything the issue request should ask for: the shown fields plus the
 *  editable one, which the view needs the current value of even though it is
 *  not in the display list. */
export function requestedFieldNames(config: IssueFieldConfig): string[] {
  if (!config.team) return config.detail;
  const has = config.detail.some(
    (n) => n.toLowerCase() === config.team.toLowerCase(),
  );
  return has ? config.detail : [...config.detail, config.team];
}
