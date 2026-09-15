import { useCallback, useEffect, useState } from "react";
import { SearchResults as Results } from "../api";
import { clearForward, useBackTarget } from "../back";
import { requestIssue } from "../issueRequest";
import {
  clearSearchRequest,
  describeSearch,
  repeatSearch,
  runSearch,
  SearchRequest,
} from "../searchRequest";
import { useRowSelected, useSelectionScope } from "../selection";
import { usePinnedIssues } from "../pins";
import IssueRow from "./IssueRow";

/** This list's name in the selection registry. */
const SCOPE = "search";

/** One result, told whether the keyboard is on it. */
function ResultRow(props: Parameters<typeof IssueRow>[0]) {
  const selected = useRowSelected(SCOPE, props.issue.key);
  return <IssueRow {...props} selected={selected} />;
}

/**
 * The results of a search run from the command palette.
 *
 * An ordinary issue list, which is the point: the rows are the same rows the
 * Todo tab draws, so the arrow keys walk them, Enter opens one, and every row
 * shortcut works here without this view arranging any of it.
 */
export default function SearchResults({
  search,
  site,
  backLabel,
}: {
  search: SearchRequest;
  site: string;
  /** Where leaving these results goes — the tab that was showing underneath. */
  backLabel: string;
}) {
  const [found, setFound] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinnedKeys = new Set(usePinnedIssues().map((p) => p.key));
  const issues = found?.issues ?? null;

  useEffect(() => {
    let cancelled = false;
    setFound(null);
    setError(null);
    runSearch(search).then(
      (result) => {
        if (!cancelled) setFound(result);
      },
      (err) => {
        if (!cancelled) {
          setFound({ issues: [], hasMore: false });
          setError(String(err));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The whole request is the dependency: it carries its own copy of the saved
    // search, so editing one while its results are up re-runs it.
  }, [search]);

  const open = useCallback((key: string) => {
    clearForward();
    requestIssue(key);
  }, []);

  useSelectionScope({
    id: SCOPE,
    rows: (issues ?? []).map((i) => i.key),
    open,
  });

  /**
   * The way out.
   *
   * Every view that replaces the content area registers one; without it Escape,
   * ⌘[, the mouse's back button and the swipe all did nothing here, and the
   * sidebar was the only exit — which failed too on the tab the search was
   * launched from, since clicking an already-active tab changes no state.
   *
   * Going forward runs the same search again, which is what re-entering results
   * means: the request carries its own copy of the definition, so it is the
   * search as it was, not as the settings have since become.
   */
  useBackTarget({
    label: backLabel,
    back: clearSearchRequest,
    forward: () => repeatSearch(search),
  });

  return (
    <div className="panel">
      <section>
        <div className="day-head">
          <span>
            Results for {describeSearch(search)}
            {issues && issues.length > 0 && ` · ${issues.length}`}
          </span>
          {/* A full page is not proof there is nothing after it, and these
              searches keep closed issues on purpose — so a plant with years of
              history reaches the limit as a matter of course. Saying "· 100"
              and stopping would have the reader count a hundred and conclude
              the hundred-and-first does not exist. */}
          {found?.hasMore && (
            <span className="muted">
              first {found.issues.length} · narrow the term to see the rest
            </span>
          )}
        </div>
        {issues === null && <p className="muted">Searching…</p>}
        {error && <p className="error">{error}</p>}
        {issues?.length === 0 && !error && (
          <p className="muted empty">
            Nothing found for {describeSearch(search)}.
          </p>
        )}
        <ul
          className="issue-list todo-list no-type-icons"
          aria-label="Search results"
        >
          {(issues ?? []).map((issue) => (
            <ResultRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned={pinnedKeys.has(issue.key)}
              // Opening a result reads the issue, the way the Todo tab's rows do.
              onSelect={(i) => open(i.key)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
