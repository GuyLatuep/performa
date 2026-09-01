import { useEffect, useState } from "react";
import { api, IssueSummary, WorklogEntry } from "../api";
import { logInfo } from "../log";
import { formatDayLabel, formatDuration } from "../time";
import IssuePicker from "./IssuePicker";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
  onLogged: () => void;
  /** Issue to open the log form for right away (e.g. picked on the start tab). */
  initialIssue?: IssueSummary | null;
  /** Name of the tab the form was opened from ("Todo", "Start", …). */
  backLabel?: string;
  /** Return to that tab. Absent on a manual visit to the log tab. */
  onBack?: () => void;
}

export default function LogWork({
  site,
  onLogged,
  initialIssue,
  backLabel,
  onBack,
}: Props) {
  const [selected, setSelected] = useState<IssueSummary | null>(
    initialIssue ?? null,
  );

  const { draft, patch, seconds } = useWorklogDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Bumped after logging so the history list below the form reloads.
  const [historyKey, setHistoryKey] = useState(0);

  function selectIssue(issue: IssueSummary) {
    // Billability shouldn't leak from the previous entry.
    patch({ nonBillable: false });
    setSelected(issue);
    logInfo(`opened log-work form for ${issue.key}`);
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
      await api.logWork(selected.key, toWorklogInput(draft, seconds));
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
        <div className="back-row">
          {/* Only while the issue the caller handed over is still the one on
              screen: once another issue is picked here, the log tab is where
              the user came from. */}
          {onBack && selected === initialIssue && (
            <button className="link" onClick={onBack}>
              ← Back to {backLabel}
            </button>
          )}
          <button className="link" onClick={() => setSelected(null)}>
            ← Choose a different issue
          </button>
        </div>
        <div className="issue-chip">
          <span className="key">{selected.key}</span>
          <span className="summary">{selected.summary}</span>
        </div>

        <WorklogFields
          draft={draft}
          patch={patch}
          seconds={seconds}
          fastTabOrder
        />

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
      <IssuePicker site={site} onSelect={selectIssue} />
    </div>
  );
}

const HISTORY_LIMIT = 10;

// History reaches back arbitrarily far, so the year has to be spelled out.
const ENTRY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
};

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
            <span>{formatDayLabel(e.date, ENTRY_DATE_FORMAT)}</span>
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
