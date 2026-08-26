import { useCallback, useEffect, useState } from "react";
import { api, invalidateCachedReads, IssueSummary } from "../api";
import { usePinnedIssues } from "../pins";
import { useIgnoredStatuses } from "../todoStatuses";
import IssueRow from "./IssueRow";
import IssueView from "./IssueView";
import { useKonamiCode } from "../konami";
import { useFunMode, useShowIssueTypeIcons } from "../settings";
import { nextSort, SortColumn, sortIssues, TodoSort } from "../todoSort";

interface Props {
  site: string;
  /** A worklog was filed from the opened issue — refresh what depends on it. */
  onLogged: () => void;
}

// Todo tab: everything waiting on the user — escalations they raised that are
// back in their court, plus every open issue assigned to them. Most urgent
// first; the query itself lives in the backend (`build_todo_jql`).
export default function Todo({ site, onLogged }: Props) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [opened, setOpened] = useState<IssueSummary | null>(null);
  const funMode = useFunMode();
  // The rows are a grid, so the header and the list have to agree on how many
  // columns there are.
  const typeIcons = useShowIssueTypeIcons();
  const [allClosed, setAllClosed] = useState(false);
  const dismiss = useCallback(() => setAllClosed(false), []);
  const wish = useCallback(() => setAllClosed(true), []);
  // Only on the list itself, and only in fun mode. Not while an issue is open:
  // the arrows belong to whatever is being read there.
  useKonamiCode(wish, funMode && opened === null && !allClosed);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pinnedKeys = new Set(usePinnedIssues().map((p) => p.key));
  // Part of the query, so a change in settings has to re-run the effect.
  const ignoredStatuses = useIgnoredStatuses();
  // Null means the order Jira sent, which is the one the query asked for.
  // Sorting happens here rather than in the query: re-running it to reorder a
  // list already on screen would be a Jira round trip for something the browser
  // can do instantly, and it would lose the ordering on every refresh.
  const [sort, setSort] = useState<TodoSort | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIssues(null);
    setError(null);
    api.todoIssues(ignoredStatuses).then(
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
  }, [reloadKey, ignoredStatuses]);

  // Statuses change in Jira, not here, so the 60s read cache would otherwise
  // hide a change the user just made in the browser.
  const reload = useCallback(() => {
    invalidateCachedReads();
    setReloadKey((k) => k + 1);
  }, []);

  if (opened) {
    return (
      <IssueView
        issue={opened}
        site={site}
        backLabel="Todo"
        onBack={() => {
          setOpened(null);
          // The issue may have been moved out of this list while it was open;
          // the list stayed mounted behind the view and would otherwise still
          // show the status it had on the way in.
          reload();
        }}
        onLogged={onLogged}
      />
    );
  }

  if (allClosed) {
    return (
      <div className="panel todo">
        {/* Click anywhere to come back — an easter egg with no way out of it
            is a bug wearing a costume. */}
        <button className="all-closed" onClick={dismiss}>
          alle Tickets sind geschlossen, so fühlt es sich also an....
        </button>
      </div>
    );
  }

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
        <ul
          className={`issue-list todo-list${typeIcons ? "" : " no-type-icons"}`}
        >
          {issues && issues.length > 0 && (
            // Column header. Inside the scroll container so it shares the row
            // grid exactly — a header outside it would drift by the width of
            // the scrollbar — and sticks to the top while the list scrolls.
            <li className="todo-columns">
              <span />
              {typeIcons && (
                <SortHeader compact column="type" sort={sort} onSort={setSort}>
                  {/* One letter, because the column is one icon wide. What it
                      stands for is in the tooltip. */}
                  T
                </SortHeader>
              )}
              <SortHeader
                className="col-key"
                column="key"
                sort={sort}
                onSort={setSort}
              >
                Issue
              </SortHeader>
              <SortHeader
                className="col-summary"
                column="summary"
                sort={sort}
                onSort={setSort}
              >
                Summary
              </SortHeader>
              <SortHeader column="priority" sort={sort} onSort={setSort}>
                Prio
              </SortHeader>
              <SortHeader column="status" sort={sort} onSort={setSort}>
                Status
              </SortHeader>
              <span />
            </li>
          )}
          {sortIssues(issues ?? [], sort).map((issue) => (
            <IssueRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned={pinnedKeys.has(issue.key)}
              onSelect={setOpened}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The name of a sortable column, and the click that reorders the list by it.
 *
 *  A button rather than a span with a handler: it is the only thing on this
 *  screen that reorders the list, and it has to be reachable by keyboard like
 *  every other control on it. */
function SortHeader({
  column,
  sort,
  onSort,
  className,
  compact = false,
  children,
}: {
  column: SortColumn;
  sort: TodoSort | null;
  onSort: (sort: TodoSort | null) => void;
  className?: string;
  /** A column too narrow to hold a name and an arrow side by side — the type
   *  column is one icon wide. It shows the arrow *instead of* its name while it
   *  is the sorted one; the tooltip says which it is either way. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  const active = sort?.column === column ? sort.direction : null;
  return (
    <button
      type="button"
      className={`col-sort${active ? " sorted" : ""}${
        className ? ` ${className}` : ""
      }`}
      title={
        active === null
          ? `Sort by ${COLUMN_NAMES[column]}`
          : active === "asc"
            ? `Sorted by ${COLUMN_NAMES[column]} — click to reverse`
            : `Sorted by ${COLUMN_NAMES[column]}, reversed — click for Jira's own order`
      }
      onClick={() => onSort(nextSort(sort, column))}
    >
      {!(compact && active) && children}
      {/* Kept at a fixed width rather than appearing and disappearing, so
          naming a column doesn't shift as it is sorted and unsorted. */}
      {!compact && (
        <span className="sort-marker" aria-hidden="true">
          {active === "asc" ? "▲" : active === "desc" ? "▼" : ""}
        </span>
      )}
      {compact && active && (
        <span className="sort-marker" aria-hidden="true">
          {active === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

/** What each column is called when a tooltip has to say it out loud. */
const COLUMN_NAMES: Record<SortColumn, string> = {
  type: "issue type",
  key: "issue key",
  summary: "summary",
  priority: "priority",
  status: "status",
};
