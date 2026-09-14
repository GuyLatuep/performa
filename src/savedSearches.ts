import { claimStoredFor, persisted } from "./persist";

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
/** Which account these were written for — see [`claimSearchesFor`]. */
const OWNER_KEY = "performa-saved-searches-owner";

const store = persisted<SavedSearch[]>(KEY, (stored) =>
  // Anything half-written is dropped rather than repaired: a search missing
  // its field would offer the palette an entry that cannot run.
  Array.isArray(stored)
    ? stored.filter(
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
      )
    : [],
);

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

/**
 * A search worth storing, or null.
 *
 * The one rule both mutators go through, because `read()` above enforces the
 * same one on the way back in: a search with no name or no field is dropped when
 * it is next loaded. Writing one is therefore not "saving an incomplete search",
 * it is deleting a search on a delay — which is what made clearing the name box
 * to retype it a way to lose the whole thing.
 */
function sanitise(
  search: Omit<SavedSearch, "id">,
): Omit<SavedSearch, "id"> | null {
  const name = search.name.trim();
  const field = search.field.trim();
  if (name === "" || field === "") return null;
  return { ...search, name, field };
}

/** Add one, and hand back what it was given an id of. */
export function addSavedSearch(
  search: Omit<SavedSearch, "id">,
): SavedSearch | null {
  const clean = sanitise(search);
  if (!clean) return null;
  const added: SavedSearch = { ...clean, id: freshId() };
  store.save([...store.get(), added]);
  return added;
}

export function removeSavedSearch(id: string): void {
  store.save(store.get().filter((s) => s.id !== id));
}

/**
 * Change one in place.
 *
 * Unknown ids are ignored rather than appended — an update to something that has
 * been deleted is not a new search. A patch that would leave it without a name or
 * a field is ignored too, for the reason on `sanitise`: storing that is a
 * deletion the user did not ask for and would not see until the next launch.
 * Removing a search is what the ✕ is for.
 */
export function updateSavedSearch(
  id: string,
  patch: Partial<Omit<SavedSearch, "id">>,
): void {
  store.save(
    store.get().map((s) => {
      if (s.id !== id) return s;
      const clean = sanitise({ ...s, ...patch });
      return clean ? { ...clean, id } : s;
    }),
  );
}

/**
 * Bind the stored searches to `account`, dropping them if they were written for
 * somebody else.
 *
 * A search names a field by the name *that site* spells it with, so it means
 * nothing on another one: signing into a second Jira would otherwise leave the
 * palette offering "Search by Plant number" for a field that site has never
 * heard of, and the search would fail with a message about a missing field the
 * reader never chose. Signing back into the same account keeps everything.
 *
 * The same shape, and the same reasoning, as `claimMentionsFor`.
 */
export function claimSearchesFor(account: string): void {
  if (claimStoredFor(OWNER_KEY, account, [KEY])) store.set([]);
}

/** Forget them all. For tests, whose localStorage outlives one of them. */
export function clearSavedSearches(): void {
  store.save([]);
}
