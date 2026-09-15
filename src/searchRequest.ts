import { api, SearchResults } from "./api";
import { clearForward } from "./back";
import { clearIssueRequest } from "./issueRequest";
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
 * a term. Searching text needs nothing but the words; a saved search needs the
 * whole definition the user wrote, which is carried here rather than looked up
 * again so that editing a search cannot change a result already on screen.
 */
export type SearchRequest =
  | { kind: "text"; term: string }
  | { kind: "saved"; term: string; search: SavedSearch }
  /** A saved definition that names no term: run as written, nothing asked for.
   *  Carries the whole definition for the same reason `saved` does. */
  | { kind: "view"; search: SavedSearch };

const store = createStore<SearchRequest | null>(null);

/**
 * Show these results, in place of whatever is on screen.
 *
 * Both of these clear the two other things the shell can be showing, for the
 * same reason the tab switch does: asking for a search is asking to *see* one.
 * The shell shows an issue opened by key in preference to a search, so without
 * the clear the palette would close, the request would run, and nothing would
 * change — with the results ambushing the reader later, when they backed out of
 * the issue. And the redo stack describes a trail that a new search has just
 * left, so a forward press must not re-enter it.
 */
function show(request: SearchRequest): void {
  clearIssueRequest();
  clearForward();
  store.set(request);
}

export function requestTextSearch(term: string): void {
  show({ kind: "text", term });
}

export function requestSavedSearch(search: SavedSearch, term: string): void {
  show({ kind: "saved", term, search });
}

/** Show a view. No term, so no second step in the palette — picking it is the
 *  whole interaction. */
export function requestView(search: SavedSearch): void {
  show({ kind: "view", search });
}

/** Ask for this search again, as a fresh request so its results re-run. */
export function repeatSearch(request: SearchRequest): void {
  show({ ...request });
}

/** Run it against Jira. */
export function runSearch(request: SearchRequest): Promise<SearchResults> {
  switch (request.kind) {
    case "text":
      return api.searchText(request.term);
    case "view":
      return api.viewIssues(request.search.jql);
    case "saved":
      return api.searchJql(request.search.jql, request.term);
  }
}

/** The search being shown, or null — which is every other moment. */
export function useRequestedSearch(): SearchRequest | null {
  return store.use();
}

/** The same, outside a render. The get/use pair every store here offers. */
export function getRequestedSearch(): SearchRequest | null {
  return store.get();
}

/** Stop showing it. The results view's way out, so also what the back gesture
 *  reaches. */
export function clearSearchRequest(): void {
  store.set(null);
}

/** What this search is called, for a heading or an empty state. */
export function describeSearch(search: SearchRequest): string {
  switch (search.kind) {
    case "text":
      return `\u201c${search.term}\u201d`;
    // Just the name: a view has no term, and "Results for Open escalations"
    // reads as the whole sentence it is.
    case "view":
      return search.search.name;
    case "saved":
      return `${search.search.name} ${search.term}`;
  }
}
