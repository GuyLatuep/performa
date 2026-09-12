import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, invalidateCachedReads, IssueSummary } from "../api";
import { clearForward } from "../back";
import { useShortcut } from "../shortcuts";
import { useScreenActions } from "../actions";
import { useRowSelected, useSelectionScope } from "../selection";
import { usePinnedIssues } from "../pins";
import { useIgnoredStatuses } from "../todoStatuses";
import IssueRow from "./IssueRow";
import IssueView from "./IssueView";
import { useKonamiCode } from "../konami";
import { useFunMode, useShowIssueTypeIcons } from "../settings";
import {
  nextSort,
  setTodoSort,
  SortColumn,
  sortIssues,
  TodoSort,
  useTodoSort,
} from "../todoSort";

interface Props {
  site: string;
  /** A worklog was filed from the opened issue — refresh what depends on it. */
  onLogged: () => void;
}

/** This list's name in the selection registry. */
const SCOPE = "todo";

/** The sortable columns, named the way the palette offers them. */
const COLUMNS = [
  { column: "type", name: "type" },
  { column: "key", name: "issue key" },
  { column: "summary", name: "summary" },
  { column: "priority", name: "priority" },
  { column: "status", name: "status" },
] as const;

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
  //
  // Kept in the settings store rather than in this component's state, so the
  // ordering somebody picked is still theirs at the next launch.
  const sort = useTodoSort();

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

  // Unbound while the list is loading, so the key disappears along with the
  // button rather than queueing a second read behind the first.
  const refreshKeys = useShortcut("refresh", reload, issues !== null);

  /** The rows as they are on screen. Hoisted out of the JSX because the arrow
   *  keys have to walk the *sorted* order — reading the unsorted `issues` here
   *  would have ↓ land somewhere other than the row below. */
  const shown = sortIssues(issues ?? [], sort);
  const openIssue = useCallback((issue: IssueSummary) => {
    clearForward();
    setOpened(issue);
  }, []);

  // The five column headers carry no chord of their own — five more keys for
  // something done rarely would be five keys badly spent — so the palette is
  // where they are reachable by keyboard at all.
  useScreenActions(
    COLUMNS.map(({ column, name }) => ({
      id: `todo.sort.${column}`,
      name: `Sort by ${name}`,
      group: "Todo",
      keywords: "order column",
      run: () => setTodoSort({ column, direction: "asc" }),
    })),
  );

  useSelectionScope({
    id: SCOPE,
    rows: shown.map((i) => i.key),
    // Enter opens the issue, which on this tab means reading it in the app.
    open: (key) => {
      const issue = shown.find((i) => i.key === key);
      if (issue) openIssue(issue);
    },
  });

  if (opened) {
    return (
      <IssueView
        issue={opened}
        site={site}
        backLabel="Todo"
        onForward={() => setOpened(opened)}
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
          <span className="head-actions">
            {/* Only while there is something to restore. The list is in Jira's
                order by default, so an always-present button would be offering
                to undo nothing most of the time. */}
            {sort !== null && (
              <button
                className="link"
                onClick={() => setTodoSort(null)}
                title="Forget the column ordering and go back to Jira's own"
              >
                Restore default
              </button>
            )}
            <button
              className="link"
              {...refreshKeys}
              onClick={reload}
              disabled={issues === null}
            >
              Refresh
            </button>
          </span>
        </div>
        {issues === null && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}
        {issues?.length === 0 && !error && (
          <p className="muted empty">Nothing waiting on you.</p>
        )}
        <ul
          className={`issue-list todo-list${typeIcons ? "" : " no-type-icons"}`}
          aria-label="Issues waiting on me"
        >
          {issues && issues.length > 0 && (
            // Column header. Inside the scroll container so it shares the row
            // grid exactly — a header outside it would drift by the width of
            // the scrollbar — and sticks to the top while the list scrolls.
            <li className="todo-columns">
              <span />
              {typeIcons && (
                <SortHeader
                  compact
                  column="type"
                  sort={sort}
                  onSort={setTodoSort}
                >
                  {/* One letter, because the column is one icon wide. What it
                      stands for is in the tooltip. */}
                  T
                </SortHeader>
              )}
              <SortHeader
                className="col-key"
                column="key"
                sort={sort}
                onSort={setTodoSort}
              >
                Issue
              </SortHeader>
              <SortHeader
                className="col-summary"
                column="summary"
                sort={sort}
                onSort={setTodoSort}
              >
                Summary
              </SortHeader>
              <SortHeader column="priority" sort={sort} onSort={setTodoSort}>
                Prio
              </SortHeader>
              <SortHeader column="status" sort={sort} onSort={setTodoSort}>
                Status
              </SortHeader>
              <span />
            </li>
          )}
          {shown.map((issue) => (
            <TodoRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned={pinnedKeys.has(issue.key)}
              onSelect={openIssue}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One row, told whether the keyboard is on it.
 *
 *  A wrapper rather than a prop threaded from the list, so the subscription is
 *  the row's own: moving the selection re-renders the two rows it concerns and
 *  leaves the other hundred and ninety-eight alone. */
function TodoRow(props: Parameters<typeof IssueRow>[0]) {
  const selected = useRowSelected(SCOPE, props.issue.key);
  return <IssueRow {...props} selected={selected} />;
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
          {active === "asc" ? (
            <ChevronUp size={12} strokeWidth={2.5} aria-hidden />
          ) : active === "desc" ? (
            <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
          ) : null}
        </span>
      )}
      {compact && active && (
        <span className="sort-marker" aria-hidden="true">
          {active === "asc" ? (
            <ChevronUp size={12} strokeWidth={2.5} aria-hidden />
          ) : (
            <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
          )}
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
