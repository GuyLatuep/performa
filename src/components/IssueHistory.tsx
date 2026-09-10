import { useEffect, useState } from "react";
import { api, WorklogEntry } from "../api";
import { formatDayLabel, formatDuration } from "../time";

// The user's own worklogs on one issue, shown next to every form that logs
// time so the same work isn't booked twice. Lives on its own rather than
// inside the log-work screen because that context is what all of them share:
// the log tab, the timer stop modal, the missing-worklog form and the
// repeat/first-booking modal each open on an issue that may already carry
// time.

const HISTORY_LIMIT = 10;

// History reaches back arbitrarily far, so the year has to be spelled out.
const ENTRY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** The user's previous worklogs on `issueKey`.
 *
 *  `refreshKey` reloads the list when it changes — for the forms that stay
 *  open after logging. The ones that close on save can leave it out. */
export default function IssueHistory({
  issueKey,
  refreshKey = 0,
}: {
  issueKey: string;
  refreshKey?: number;
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
      {history !== null && history.length > 0 && (
        <div className="issue-history-list">
          {history.slice(0, HISTORY_LIMIT).map((e) => (
            <div key={e.id} className="worklog-row">
              <div className="worklog-main">
                <span>{formatDayLabel(e.date, ENTRY_DATE_FORMAT)}</span>
                {e.comment && <span className="comment">{e.comment}</span>}
              </div>
              {e.time && <span className="wl-time">{e.time}</span>}
              <span className="duration">
                {formatDuration(e.timeSpentSeconds)}
              </span>
            </div>
          ))}
        </div>
      )}
      {history !== null && history.length > HISTORY_LIMIT && (
        <p className="muted history-more">
          + {history.length - HISTORY_LIMIT} older{" "}
          {history.length - HISTORY_LIMIT === 1 ? "entry" : "entries"}
        </p>
      )}
    </div>
  );
}
