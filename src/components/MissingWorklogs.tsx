import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, MissingWorklog } from "../api";
import { toDateInput, toTimeInput } from "../time";
import {
  markMissingSeen,
  refreshMissing,
  useMissing,
  useMissingError,
  useMissingLastChecked,
} from "../missing";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
  onLogged: () => void;
}

// Reminder list: issues with recent own activity but no worklog around it.
// Clicking an item opens an inline log form; saving returns to the refreshed
// list. DEV issues log their time on the linked escalation-source issue.
export default function MissingWorklogs({ site, onLogged }: Props) {
  const items = useMissing();
  const error = useMissingError();
  const lastChecked = useMissingLastChecked();
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState<MissingWorklog | null>(null);

  // Viewing the tab acknowledges the current findings (stops the blinking).
  useEffect(() => {
    markMissingSeen();
  }, [items]);

  async function refresh() {
    setBusy(true);
    await refreshMissing();
    setBusy(false);
  }

  if (logging) {
    return (
      <LogForm
        item={logging}
        onCancel={() => setLogging(null)}
        onSaved={async () => {
          setLogging(null);
          onLogged();
          await refreshMissing();
        }}
      />
    );
  }

  return (
    <div className="panel">
      <div className="missing-head">
        <span className="hint">
          Issues you commented on or moved in the last 24 hours without logging
          time around it. Rechecked every 2 minutes; activity from the last 10
          minutes isn't flagged yet.
        </span>
        <div className="missing-actions">
          <button className="link" onClick={refresh} disabled={busy}>
            {busy ? "Checking…" : "Check now"}
          </button>
          {lastChecked && (
            <span className="missing-meta">at {lastChecked}</span>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !lastChecked && (
        <p className="muted empty">Checking…</p>
      )}
      {!error && lastChecked && items.length === 0 && (
        <p className="muted empty">Nothing unlogged. All caught up.</p>
      )}

      {items.map((item) => (
        <div key={`${item.issueKey}-${item.activityAt}`} className="worklog-row">
          <div className="worklog-main">
            <button
              className="key-link key"
              title={`Open ${item.issueKey} in browser`}
              onClick={() => openUrl(`${site}/browse/${item.issueKey}`)}
            >
              {item.issueKey}
            </button>
            <button
              className="issue-select missing-select"
              title={`Log work on ${item.logKey}`}
              onClick={() => setLogging(item)}
            >
              <span className="summary">{item.issueSummary}</span>
              {item.detail && (
                <span className="comment">
                  {item.kind === "comment" ? `“${item.detail}”` : item.detail}
                </span>
              )}
              {item.logKey !== item.issueKey && (
                <span className="comment">
                  → logs on {item.logKey} · {item.logSummary}
                </span>
              )}
            </button>
          </div>
          <span className="missing-meta">
            {item.kind === "comment" ? "commented" : "status changed"}{" "}
            {timeAgo(item.activityAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LogForm({
  item,
  onCancel,
  onSaved,
}: {
  item: MissingWorklog;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Default the start to the flagged activity, so the new worklog covers it
  // and the reminder clears.
  const activity = new Date(item.activityAt);
  const { draft, patch, seconds } = useWorklogDraft({
    date: toDateInput(activity),
    time: toTimeInput(activity),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(
        item.logKey,
        seconds,
        draft.date,
        draft.time,
        draft.comment,
        !draft.nonBillable,
      );
      onSaved();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <button className="link" onClick={onCancel}>
        ← Back to the list
      </button>
      <div className="issue-chip">
        <span className="key">{item.logKey}</span>
        <span className="summary">{item.logSummary}</span>
      </div>
      {item.logKey !== item.issueKey && (
        <p className="hint missing-source">
          Escalation source of <span className="key">{item.issueKey}</span> —
          the time is logged here.
        </p>
      )}
      {item.detail && (
        <p className="hint missing-reason">
          {item.kind === "comment" ? "Your comment" : "Status change"}{" "}
          {timeAgo(item.activityAt)}:{" "}
          {item.kind === "comment" ? `“${item.detail}”` : item.detail}
        </p>
      )}

      <WorklogFields draft={draft} patch={patch} seconds={seconds} />

      {error && <p className="error">{error}</p>}

      <button onClick={save} disabled={busy}>
        {busy ? "Logging…" : "Log work"}
      </button>
    </div>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
