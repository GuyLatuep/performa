import { useCallback, useEffect, useState } from "react";
import { api, IssueSummary } from "../api";
import { clearForward } from "../back";
import { requestIssue } from "../issueRequest";
import { describeSearch, SearchRequest } from "../searchRequest";
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
}: {
  search: SearchRequest;
  site: string;
}) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinnedKeys = new Set(usePinnedIssues().map((p) => p.key));

  useEffect(() => {
    let cancelled = false;
    setIssues(null);
    setError(null);
    const run =
      search.kind === "text"
        ? api.searchText(search.term)
        : api.searchField(
            search.search.field,
            search.term,
            search.search.exact,
            search.search.excludedProjects,
          );
    run.then(
      (list) => {
        if (!cancelled) setIssues(list);
      },
      (err) => {
        if (!cancelled) {
          setIssues([]);
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

  return (
    <div className="panel">
      <section>
        <div className="day-head">
          <span>
            Results for {describeSearch(search)}
            {issues && issues.length > 0 && ` · ${issues.length}`}
          </span>
        </div>
        {issues === null && <p className="muted">Searching…</p>}
        {error && <p className="error">{error}</p>}
        {issues?.length === 0 && !error && (
          <p className="muted empty">
            Nothing found for {describeSearch(search)}.
          </p>
        )}
        <ul className="issue-list todo-list no-type-icons">
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
