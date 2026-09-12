import { SavedSearch } from "./savedSearches";
import { createStore } from "./store";

/**
 * A search somebody asked for in the command palette.
 *
 * The same arrangement as `issueRequest`, and for the same reason: the palette
 * sits outside the app tree, so what it wants shown arrives as a request the
 * shell answers rather than a call into a component it cannot see.
 *
 * Two shapes, because there are two kinds of search and they differ in more than
 * a term. Searching text needs nothing but the words; searching a field needs
 * the whole definition the user wrote, which is carried here rather than looked
 * up again so that editing a search cannot change a result already on screen.
 */
export type SearchRequest =
  | { kind: "text"; term: string }
  | { kind: "field"; term: string; search: SavedSearch };

const store = createStore<SearchRequest | null>(null);

export function requestTextSearch(term: string): void {
  store.set({ kind: "text", term });
}

export function requestFieldSearch(search: SavedSearch, term: string): void {
  store.set({ kind: "field", term, search });
}

/** The search being shown, or null — which is every other moment. */
export function useRequestedSearch(): SearchRequest | null {
  return store.use();
}

/** Stop showing it. The results view's way out, so also what the back gesture
 *  reaches. */
export function clearSearchRequest(): void {
  store.set(null);
}

/** What this search is called, for a heading or an empty state. */
export function describeSearch(search: SearchRequest): string {
  return search.kind === "text"
    ? `\u201c${search.term}\u201d`
    : `${search.search.name} ${search.term}`;
}
