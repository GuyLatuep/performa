import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, IssueSummary, WorklogEntry } from "../api";
import { formatDuration, today } from "../time";
import { startTimer, useTimer } from "../timer";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
  onLogged: () => void;
}

export default function LogWork({ site, onLogged }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<IssueSummary | null>(null);

  const { draft, patch, seconds } = useWorklogDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const activeTimer = useTimer();
  const debounce = useRef<number | undefined>(undefined);
  // Bumped after logging so the history list below the form reloads.
  const [historyKey, setHistoryKey] = useState(0);

  // Load issues assigned to me on mount.
  useEffect(() => {
    runSearch("");
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => runSearch(value), 300);
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

  async function submit() {
    if (!selected) return;
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.logWork(
        selected.key,
        seconds,
        draft.date,
        draft.time,
        draft.comment,
        !draft.nonBillable,
      );
      setOkMsg(`Logged ${formatDuration(seconds)} on ${selected.key}`);
      patch({ duration: "", comment: "", nonBillable: false });
      setHistoryKey((k) => k + 1);
      onLogged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <div className="panel">
        <button className="link" onClick={() => setSelected(null)}>
          ← Choose a different issue
        </button>
        <div className="issue-chip">
          <span className="key">{selected.key}</span>
          <span className="summary">{selected.summary}</span>
        </div>

        <WorklogFields draft={draft} patch={patch} seconds={seconds} />

        {error && <p className="error">{error}</p>}
        {okMsg && <p className="success">{okMsg}</p>}

        <button onClick={submit} disabled={busy}>
          {busy ? "Logging…" : "Log work"}
        </button>

        <IssueHistory issueKey={selected.key} refreshKey={historyKey} />
      </div>
    );
  }

  return (
    <div className="panel">
      <label>
        Find an issue
        <input
          type="text"
          placeholder="Search text or issue key (blank = assigned to me)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
      </label>

      {error && <p className="error">{error}</p>}
      {searching && <p className="muted">Searching…</p>}

      <ul className="issue-list">
        {results.map((issue) => {
          const isRunning = activeTimer?.issueKey === issue.key;
          return (
            <li key={issue.key}>
              <button
                className="issue-open key"
                title={`Open ${issue.key} in browser`}
                onClick={() => openUrl(`${site}/browse/${issue.key}`)}
              >
                {issue.key}
              </button>
              <button
                className="issue-select"
                onClick={() => {
                  // Billability shouldn't leak from the previous entry.
                  patch({ nonBillable: false });
                  setSelected(issue);
                }}
              >
                <span className="summary">{issue.summary}</span>
              </button>
              <button
                className={`timer-start${isRunning ? " running" : ""}`}
                disabled={!!activeTimer}
                title={
                  isRunning
                    ? "Timer running"
                    : activeTimer
                      ? "Stop the running timer first"
                      : `Start timer for ${issue.key}`
                }
                onClick={() => startTimer(issue.key, issue.summary)}
              >
                {isRunning ? "● timing" : "▶ start"}
              </button>
            </li>
          );
        })}
        {!searching && results.length === 0 && (
          <li className="muted empty">No matching issues.</li>
        )}
      </ul>
    </div>
  );
}

const HISTORY_LIMIT = 10;

/** The user's previous worklogs on the selected issue. */
function IssueHistory({
  issueKey,
  refreshKey,
}: {
  issueKey: string;
  refreshKey: number;
}) {
  const [history, setHistory] = useState<WorklogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.issueWorklogs(issueKey).then(
      (list) => {
        if (!cancelled) setHistory(list);
      },
      (err) => {
        if (!cancelled) {
          setHistory([]);
          setError(String(err));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issueKey, refreshKey]);

  const total = (history ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0);

  return (
    <div className="issue-history">
      <div className="day-head">
        <span>My logged time</span>
        {history !== null && history.length > 0 && (
          <span className="muted">{formatDuration(total)}</span>
        )}
      </div>
      {history === null && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {history?.length === 0 && !error && (
        <p className="muted empty">No time logged on this issue yet.</p>
      )}
      {history?.slice(0, HISTORY_LIMIT).map((e) => (
        <div key={e.id} className="worklog-row">
          <div className="worklog-main">
            <span>{formatHistoryDate(e.date)}</span>
            {e.comment && <span className="comment">{e.comment}</span>}
          </div>
          {e.time && <span className="wl-time">{e.time}</span>}
          <span className="duration">{formatDuration(e.timeSpentSeconds)}</span>
        </div>
      ))}
      {history !== null && history.length > HISTORY_LIMIT && (
        <p className="muted history-more">
          + {history.length - HISTORY_LIMIT} older{" "}
          {history.length - HISTORY_LIMIT === 1 ? "entry" : "entries"}
        </p>
      )}
    </div>
  );
}

function formatHistoryDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  const label = d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return date === today() ? `${label} · Today` : label;
}
