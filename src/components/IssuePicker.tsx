import { useEffect, useRef, useState } from "react";
import { api, IssueSummary } from "../api";
import { usePinnedIssues } from "../pins";
import {
  moveSelection,
  openSelected,
  useRowSelected,
  useSelectionScope,
} from "../selection";
import IssueRow from "./IssueRow";

// Find one of your issues and hand it to whoever asked. The log tab's front
// half and the month matrix's quick-log dialog both need exactly this, and
// duplicating the debounce and the pinned-issue merge for the second one would
// be two places to fix the next time either changes.

interface Props {
  site: string;
  onSelect: (issue: IssueSummary) => void;
  autoFocus?: boolean;
}

/** How long to wait for the typing to stop before asking Jira. Long enough
 *  that a word costs one search rather than five. */
const DEBOUNCE_MS = 300;

/** This list's name in the selection registry. */
const SCOPE = "picker";

/** One result, told whether the keyboard is on it. */
function PickerRow(props: Parameters<typeof IssueRow>[0]) {
  const selected = useRowSelected(SCOPE, props.issue.key);
  return <IssueRow {...props} selected={selected} />;
}

export default function IssuePicker({
  site,
  onSelect,
  autoFocus = true,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinnedIssues = usePinnedIssues();
  const pinnedKeys = new Set(pinnedIssues.map((p) => p.key));
  // Pinned issues lead the default list; an active search shows plain results.
  const showPinned = query.trim() === "" && pinnedIssues.length > 0;
  const debounce = useRef<number | undefined>(undefined);

  // Load issues assigned to me on mount.
  useEffect(() => {
    runSearch("");
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  // The query is interpreted on the Rust side (blank = my open issues,
  // issue key = exact lookup, anything else = text search).
  async function runSearch(value: string) {
    setSearching(true);
    setError(null);
    try {
      setResults(await api.searchIssues(value));
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  /** The rows as they are on screen: the pinned issues lead, then the results
   *  that are not already among them. */
  const shown = [
    ...(showPinned ? pinnedIssues : []),
    ...results.filter((i) => !showPinned || !pinnedKeys.has(i.key)),
  ];

  useSelectionScope({
    id: SCOPE,
    rows: shown.map((i) => i.key),
    open: (key) => {
      const issue = shown.find((i) => i.key === key);
      if (issue) onSelect(issue);
    },
  });

  /**
   * The arrows and Enter, handled here rather than left to the window listener.
   *
   * The search box has focus the whole time this list is being read — it
   * autofocuses, and you are typing into it — so the global handler's typing
   * guard rightly keeps out of it. But a search box above its own results is the
   * one place arrows should move the results rather than the cursor, which is
   * exactly what every other typeahead in this app does on its own input.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    let acted = false;
    if (e.key === "ArrowDown") acted = moveSelection(1);
    else if (e.key === "ArrowUp") acted = moveSelection(-1);
    else if (e.key === "Enter") acted = openSelected();
    else return;
    // Claimed, so the caret stays where it is and the page does not scroll — and
    // so the window listeners know this press is spoken for.
    if (acted) e.preventDefault();
  }

  return (
    <>
      <label>
        Find an issue
        <input
          type="text"
          placeholder="Search text or issue key (blank = assigned to me)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
      </label>

      {error && <p className="error">{error}</p>}
      {searching && <p className="muted">Searching…</p>}

      <ul className="issue-list">
        {showPinned &&
          pinnedIssues.map((issue, i) => (
            <PickerRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned
              lastPinned={i === pinnedIssues.length - 1}
              onSelect={onSelect}
            />
          ))}
        {results
          .filter((issue) => !showPinned || !pinnedKeys.has(issue.key))
          .map((issue) => (
            <PickerRow
              key={issue.key}
              issue={issue}
              site={site}
              pinned={pinnedKeys.has(issue.key)}
              onSelect={onSelect}
            />
          ))}
        {!searching && results.length === 0 && (
          <li className="muted empty">No matching issues.</li>
        )}
      </ul>
    </>
  );
}
