import { useCallback, useEffect, useState } from "react";
import { api, invalidateCachedReads, IssueSummary } from "../api";
import { usePinnedIssues } from "../pins";
import IssueRow from "./IssueRow";

interface Props {
  site: string;
  /** Jump to the log-work tab with this issue preselected. */
  onSelectIssue: (issue: IssueSummary) => void;
}

// Todo tab: everything waiting on the user — escalations they raised that are
// back in their court, plus every open issue assigned to them. Most urgent
// first; the query itself lives in the backend (`build_todo_jql`).
export default function Todo({ site, onSelectIssue }: Props) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pinnedKeys = new Set(usePinnedIssues().map((p) => p.key));

  useEffect(() => {
    let cancelled = false;
    setIssues(null);
    setError(null);
    api.todoIssues().then(
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
  }, [reloadKey]);

  // Statuses change in Jira, not here, so the 60s read cache would otherwise
  // hide a change the user just made in the browser.
  const reload = useCallback(() => {
    invalidateCachedReads();
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className="panel todo">
      <section>
        <div className="day-head">
          <span>
            Waiting on me
            {issues && issues.length > 0 && ` · ${issues.length}`}
          </span>
          <button className="link" onClick={reload} disabled={issues === null}>
            Refresh
          </button>
        </div>
        {issues === null && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}
        {issues?.length === 0 && !error && (
          <p className="muted empty">Nothing waiting on you.</p>
        )}
        <ul className="issue-list todo-list">
          {issues && issues.length > 0 && (
            // Column header. Inside the scroll container so it shares the row
            // grid exactly — a header outside it would drift by the width of
            // the scrollbar — and sticks to the top while the list scrolls.
            <li className="todo-columns" aria-hidden="true">
              <span />
              <span>Issue</span>
              <span>Summary</span>
              <span>Prio</span>
              <span>Status</span>
              <span />
            </li>
          )}
          {issues?.map((issue) => (
            <IssueRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned={pinnedKeys.has(issue.key)}
              onSelect={onSelectIssue}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
