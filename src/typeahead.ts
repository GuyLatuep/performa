import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** How long the typing has to stop before Jira is asked. One request per
 *  keystroke would be one Jira request per keystroke. */
const DEBOUNCE_MS = 250;

/** A list of matches and the row the keyboard is on. */
export interface Typeahead<T> {
  matches: T[];
  /** Index the keyboard is on. Mouse hover moves it too, so the two never
   *  disagree about what Enter would pick. */
  active: number;
  setActive: Dispatch<SetStateAction<number>>;
}

/**
 * Search-as-you-type against Jira.
 *
 * `query` is what to look for, or null while there is nothing to search for —
 * the list is closed, or the box is empty. Blank is a query in its own right
 * where a picker offers something up front, so emptiness is the caller's call
 * rather than this hook's.
 *
 * `search` must keep its identity across renders; a new one re-runs the search.
 *
 * A failed lookup leaves the list empty rather than reporting anything: a
 * picker is not the place to say Jira is unreachable, and the form around it
 * already carries a banner for that.
 */
export function useTypeahead<T>(
  query: string | null,
  search: (query: string) => Promise<T[]>,
): Typeahead<T> {
  const [matches, setMatches] = useState<T[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (query === null) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      search(query).then(
        (found) => {
          if (cancelled) return;
          setMatches(found);
          // A new result set starts at the top; keeping the old index would
          // leave the highlight on whoever happens to sit at that position.
          setActive(0);
        },
        () => !cancelled && setMatches([]),
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, search]);

  return { matches, active, setActive };
}

/**
 * The keys an open list of matches owns.
 *
 * Returns true when the press was spent here, which is the caller's cue to
 * claim it: the arrows must not move the caret out from under the query being
 * typed, and Enter must choose a match rather than submit or break the line.
 *
 * `close` is optional because Escape does not always belong to the list — in
 * the comment box it has to answer even when nothing matched, so that box
 * handles it before asking here.
 */
export function typeaheadKey<T>(
  key: string,
  list: Typeahead<T> & { choose: (item: T) => void; close?: () => void },
): boolean {
  const { matches, active, setActive, choose, close } = list;
  if (matches.length === 0) return false;

  switch (key) {
    case "ArrowDown":
      setActive((i) => (i + 1) % matches.length);
      return true;
    case "ArrowUp":
      setActive((i) => (i - 1 + matches.length) % matches.length);
      return true;
    case "Enter":
    case "Tab":
      choose(matches[active] ?? matches[0]);
      return true;
    case "Escape":
      if (!close) return false;
      close();
      return true;
    default:
      return false;
  }
}
