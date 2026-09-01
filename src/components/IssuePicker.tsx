import { useEffect, useRef, useState } from "react";
import { api, IssueSummary } from "../api";
import { usePinnedIssues } from "../pins";
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

  return (
    <>
      <label>
        Find an issue
        <input
          type="text"
          placeholder="Search text or issue key (blank = assigned to me)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>

      {error && <p className="error">{error}</p>}
      {searching && <p className="muted">Searching…</p>}

      <ul className="issue-list">
        {showPinned &&
          pinnedIssues.map((issue, i) => (
            <IssueRow
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
            <IssueRow
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
