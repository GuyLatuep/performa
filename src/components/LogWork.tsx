import { useEffect, useRef, useState } from "react";
import { api, IssueSummary, WorklogEntry } from "../api";
import { parseDuration, formatDuration, today, nowTime } from "../time";
import { startTimer, useTimer } from "../timer";

interface Props {
  onLogged: () => void;
}

const escapeJql = (s: string) => s.replace(/["\\]/g, "\\$&");

export default function LogWork({ onLogged }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<IssueSummary | null>(null);

  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState(nowTime());
  const [comment, setComment] = useState("");
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

  async function runSearch(value: string) {
    setSearching(true);
    setError(null);
    const trimmed = value.trim();
    let jql: string;
    if (!trimmed) {
      jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
    } else if (/^[A-Za-z][A-Za-z0-9]+-\d+$/.test(trimmed)) {
      jql = `key = "${trimmed.toUpperCase()}"`;
    } else {
      jql = `(summary ~ "${escapeJql(trimmed)}*" OR text ~ "${escapeJql(trimmed)}") ORDER BY updated DESC`;
    }
    try {
      setResults(await api.searchIssues(jql));
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!selected) return;
    const seconds = parseDuration(duration);
    if (seconds === null) {
      setError("Enter a valid duration, e.g. 1h 30m");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.logWork(selected.key, seconds, date, time, comment);
      setOkMsg(`Logged ${formatDuration(seconds)} on ${selected.key}`);
      setDuration("");
      setComment("");
      setHistoryKey((k) => k + 1);
      onLogged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const seconds = parseDuration(duration);
    return (
      <div className="panel">
        <button className="link" onClick={() => setSelected(null)}>
          ← Choose a different issue
        </button>
        <div className="issue-chip">
          <span className="key">{selected.key}</span>
          <span className="summary">{selected.summary}</span>
        </div>

        <label>
          Time spent
          <input
            type="text"
            placeholder="1h 30m"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            autoFocus
          />
          {seconds !== null && (
            <span className="hint">= {formatDuration(seconds)}</span>
          )}
        </label>

        <div className="field-row">
          <label>
            Date
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Start time
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>

        <label>
          Comment (optional)
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>

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
              <button className="issue-select" onClick={() => setSelected(issue)}>
                <span className="key">{issue.key}</span>
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
