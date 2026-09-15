import { claimStoredFor, persisted } from "./persist";

/**
 * Searches the user has built for themselves.
 *
 * What is worth searching is a property of the Jira site, not of this app — one
 * site keeps a plant number, another a customer reference, another neither — so
 * the app ships none and offers the means to describe them. Each one then
 * appears in the command palette as "Search by <name>".
 */
export interface SavedSearch {
  /** Stable for the life of the search, so the palette's action id is too. */
  id: string;
  /** What it is called, and what the palette offers: "Search by Plant number". */
  name: string;
  /**
   * The JQL it runs, with [`SEARCH_TERM_PLACEHOLDER`] where the palette's term
   * goes: `project in (CTS, DEV) AND "Plant no." ~ %SEARCHTERM%`.
   *
   * The term is put in on the Rust side, escaped, so the query is the user's but
   * what gets typed into the palette can never rewrite it.
   */
  jql: string;
}

/** Where the palette's term goes in a search's JQL. Mirrors
 *  `SEARCH_TERM_PLACEHOLDER` in `src-tauri/src/jira/jql.rs`. */
export const SEARCH_TERM_PLACEHOLDER = "%SEARCHTERM%";

/** Does this JQL say where the term goes? Case-insensitive, as the Rust side is.
 *  One that does not is refused there when it runs. */
export function hasSearchTerm(jql: string): boolean {
  return jql.toUpperCase().includes(SEARCH_TERM_PLACEHOLDER);
}

const KEY = "performa-saved-searches";
/** Which account these were written for — see [`claimSearchesFor`]. */
const OWNER_KEY = "performa-saved-searches-owner";

/** `"a"`, escaped for a JQL string. */
function quoted(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The JQL a search from before searches were written as JQL stands for.
 *
 * Those named a field, a whole-value switch and projects to leave out, and the
 * Rust side built this same query from them — so rewriting them keeps every
 * search the user already had, finding what it found. The one difference is that
 * the field is now named rather than looked up by id; the name came from the
 * site's own catalogue, so it is spelled the way the site spells it.
 */
function legacyJql(field: string, exact: boolean, excluded: string[]): string {
  const f = quoted(field.trim());
  const p = SEARCH_TERM_PLACEHOLDER;
  const match = exact ? `${f} = ${p}` : `(${f} ~ "${p}*" OR ${f} ~ ${p})`;
  const leftOut =
    excluded.length > 0
      ? ` AND project NOT IN (${excluded.map(quoted).join(", ")})`
      : "";
  return `${match}${leftOut} ORDER BY updated DESC`;
}

/** One stored entry as a search, or null when it is not one.
 *
 *  `unknown` rather than `any`: this reads whatever localStorage happens to
 *  hold, so every field has to be proven before it is used — which the body
 *  already did. Typing it `any` only meant the compiler was not checking that
 *  the proofs covered everything the returned object touches. */
function fromStored(stored: unknown): SavedSearch | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.name !== "string") return null;
  const name = s.name.trim();
  if (name === "") return null;
  if (typeof s.jql === "string") {
    const jql = s.jql.trim();
    return jql === "" ? null : { id: s.id, name, jql };
  }
  if (
    typeof s.field === "string" &&
    s.field.trim() !== "" &&
    typeof s.exact === "boolean" &&
    Array.isArray(s.excludedProjects) &&
    s.excludedProjects.every((p: unknown) => typeof p === "string")
  ) {
    return {
      id: s.id,
      name,
      jql: legacyJql(s.field, s.exact, s.excludedProjects as string[]),
    };
  }
  return null;
}

const store = persisted<SavedSearch[]>(KEY, (stored) =>
  // Anything half-written is dropped rather than repaired: a search missing its
  // JQL would offer the palette an entry that cannot run.
  Array.isArray(stored)
    ? stored.map(fromStored).filter((s): s is SavedSearch => s !== null)
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
 * same one on the way back in: a search with no name or no JQL is dropped when
 * it is next loaded. Writing one is therefore not "saving an incomplete search",
 * it is deleting a search on a delay — which is what made clearing the name box
 * to retype it a way to lose the whole thing.
 *
 * JQL without the placeholder is still stored: refusing it would snap the box
 * back mid-edit, and the settings screen marks it instead.
 */
function sanitise(
  search: Omit<SavedSearch, "id">,
): Omit<SavedSearch, "id"> | null {
  const name = search.name.trim();
  const jql = search.jql.trim();
  if (name === "" || jql === "") return null;
  return { name, jql };
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
 * JQL is ignored too, for the reason on `sanitise`: storing that is a deletion
 * the user did not ask for and would not see until the next launch. Removing a
 * search is what the ✕ is for.
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
 * A search's JQL names fields and projects the way *that site* spells them, so
 * it means nothing on another one: signing into a second Jira would otherwise
 * leave the palette offering "Search by Plant number" for a field that site has
 * never heard of, and the search would fail with a message about a field the
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
