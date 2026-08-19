import { createStore } from "./store";

// Workflow statuses the todo tab leaves out, per project. The query already
// drops anything in Jira's Done category, whatever a workflow calls those
// statuses; this covers the open-but-not-mine ones ("Waiting for customer", a
// review queue, …), which every site names differently and so cannot be
// shipped hardcoded.
//
// Per project rather than one global list, because the same name can mean
// different things in two workflows — and because most sites reuse the same
// statuses everywhere, `copyIgnoredStatuses` fills the rest in one go.
//
// Status *names* are what JQL matches on, so that is what gets stored. Empty
// by default: a name that doesn't exist on the site makes Jira reject the
// whole query, so nothing may go in here that the user didn't pick from their
// own Jira.

const IGNORED_KEY = "performa-todo-ignored-statuses";

/** Project key → the statuses hidden in it. */
export type IgnoredStatuses = Record<string, string[]>;

/** Trimmed, case-insensitively deduped, sorted — the shape the store always
 *  holds, so the todo read cache keys on the selection and not on the order
 *  the boxes happened to be ticked in. Projects left with nothing ignored are
 *  dropped rather than kept as empty entries. */
function normalize(ignored: IgnoredStatuses): IgnoredStatuses {
  const out: IgnoredStatuses = {};
  for (const project of Object.keys(ignored).sort()) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of ignored[project]) {
      const name = raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      names.push(name);
    }
    if (names.length) out[project] = names.sort((a, b) => a.localeCompare(b));
  }
  return out;
}

function readIgnored(): IgnoredStatuses {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(IGNORED_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const parsed: IgnoredStatuses = {};
    for (const [project, names] of Object.entries(raw)) {
      if (!Array.isArray(names)) continue;
      parsed[project] = names.filter((n): n is string => typeof n === "string");
    }
    return normalize(parsed);
  } catch {
    return {};
  }
}

const store = createStore<IgnoredStatuses>(readIgnored());

function save(ignored: IgnoredStatuses): void {
  const next = normalize(ignored);
  localStorage.setItem(IGNORED_KEY, JSON.stringify(next));
  // Always a fresh object — the store compares with Object.is, so an in-place
  // edit would be swallowed.
  store.set(next);
}

export function getIgnoredStatuses(): IgnoredStatuses {
  return store.get();
}

export function setIgnoredStatuses(ignored: IgnoredStatuses): void {
  save(ignored);
}

/** The statuses hidden in one project. Always a list, so callers don't have to
 *  care whether the project has been configured yet. */
export function projectIgnoredStatuses(
  ignored: IgnoredStatuses,
  project: string,
): string[] {
  return ignored[project] ?? [];
}

export function toggleIgnoredStatus(project: string, name: string): void {
  const current = store.get();
  const names = projectIgnoredStatuses(current, project);
  save({
    ...current,
    [project]: names.some((s) => s.toLowerCase() === name.toLowerCase())
      ? names.filter((s) => s.toLowerCase() !== name.toLowerCase())
      : [...names, name],
  });
}

/** Give every project in `targets` the same list as `from`, replacing whatever
 *  they had — most sites reuse the same statuses across projects, and ticking
 *  them one project at a time is the tedious part. Replacing rather than
 *  merging is what makes it a copy: the targets match the source afterwards,
 *  including when the source ignores nothing. */
export function copyIgnoredStatuses(from: string, targets: string[]): void {
  const current = store.get();
  const names = projectIgnoredStatuses(current, from);
  const next = { ...current };
  for (const target of targets) {
    if (target === from) continue;
    next[target] = [...names];
  }
  save(next);
}

export function useIgnoredStatuses(): IgnoredStatuses {
  return store.use();
}
