import { createStore } from "./store";

/**
 * Searches the user has built for themselves.
 *
 * Which fields are worth searching is a property of the Jira site, not of this
 * app — one site keeps a plant number, another a customer reference, another
 * neither — so the app ships none and offers the means to describe them. Each
 * one then appears in the command palette as "Search by <name>".
 */
export interface SavedSearch {
  /** Stable for the life of the search, so the palette's action id is too. */
  id: string;
  /** What it is called, and what the palette offers: "Search by Plant number". */
  name: string;
  /** The field to look in, as the site spells it. Resolved to a field id on the
   *  Rust side, since a name in JQL has to be exact and an id cannot be. */
  field: string;
  /**
   * Match the whole value rather than part of it.
   *
   * Off — "like" — is the common case and the more forgiving: the term is
   * wildcarded, so `DE_1979` finds `DE_1979_03` as well. On is for fields whose
   * values are whole things in themselves, where a partial match would drag in
   * every neighbour sharing an opening.
   */
  exact: boolean;
  /** Project keys to leave out. For the projects that hold the same field for
   *  something else, or that nobody searching this field cares about. */
  excludedProjects: string[];
}

const KEY = "performa-saved-searches";

function read(): SavedSearch[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    // Anything half-written is dropped rather than repaired: a search missing
    // its field would offer the palette an entry that cannot run.
    return raw.filter(
      (s): s is SavedSearch =>
        !!s &&
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        s.name.trim() !== "" &&
        typeof s.field === "string" &&
        s.field.trim() !== "" &&
        typeof s.exact === "boolean" &&
        Array.isArray(s.excludedProjects) &&
        s.excludedProjects.every((p: unknown) => typeof p === "string"),
    );
  } catch {
    return [];
  }
}

const store = createStore<SavedSearch[]>(read());

function save(next: SavedSearch[]): void {
  localStorage.setItem(KEY, JSON.stringify(next));
  store.set(next);
}

export function getSavedSearches(): SavedSearch[] {
  return store.get();
}

export function useSavedSearches(): SavedSearch[] {
  return store.use();
}

/** How many ids this session has issued. Only ever goes up. */
let issued = 0;

/**
 * An id nothing has held before.
 *
 * Both halves earn their place. The clock keeps a new session clear of the last
 * one's ids; the counter keeps two searches written in the same millisecond
 * apart, which is not hypothetical — it is what adding two in a row does, and
 * with a bare timestamp they collided and an edit to one changed both.
 *
 * Deliberately not "an id no *current* search holds": deleting one would free it
 * again, and the palette's entry is built from this, so a reused id is an entry
 * that quietly changes meaning.
 */
function freshId(): string {
  issued += 1;
  return `s${Date.now().toString(36)}-${issued.toString(36)}`;
}

/** Add one, and hand back what it was given an id of. */
export function addSavedSearch(
  search: Omit<SavedSearch, "id">,
): SavedSearch | null {
  if (search.name.trim() === "" || search.field.trim() === "") return null;
  const added: SavedSearch = {
    ...search,
    name: search.name.trim(),
    id: freshId(),
  };
  save([...store.get(), added]);
  return added;
}

export function removeSavedSearch(id: string): void {
  save(store.get().filter((s) => s.id !== id));
}

/** Change one in place. Unknown ids are ignored rather than appended — an update
 *  to something that has been deleted is not a new search. */
export function updateSavedSearch(
  id: string,
  patch: Partial<Omit<SavedSearch, "id">>,
): void {
  save(store.get().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

/** Forget them all. For tests, whose localStorage outlives one of them. */
export function clearSavedSearches(): void {
  save([]);
}
