import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, WorklogEntry } from "../api";
import { formatDuration, today, weekRange } from "../time";
import WeekChart from "./WeekChart";
import RepeatModal from "./RepeatModal";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
  refreshKey: number;
}

export default function Timesheet({ site, refreshKey }: Props) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorklogEntry | null>(null);
  const [repeating, setRepeating] = useState<WorklogEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { start, end } = weekRange(offset);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.listWorklogs(start, end));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const total = entries.reduce((sum, e) => sum + e.timeSpentSeconds, 0);

  // Group by date, descending.
  const byDate = new Map<string, WorklogEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  async function remove(entry: WorklogEntry) {
    try {
      await api.deleteWorklog(entry.issueKey, entry.id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  const label =
    offset === 0 ? "This week" : offset === -1 ? "Last week" : `${start} – ${end}`;

  return (
    <div className="panel">
      <div className="week-nav">
        <button className="secondary" onClick={() => setOffset(offset - 1)}>
          ←
        </button>
        <div className="week-label">
          <strong>{label}</strong>
          <span className="muted">
            {start} – {end}
          </span>
        </div>
        <button
          className="secondary"
          onClick={() => setOffset(offset + 1)}
          disabled={offset >= 0}
        >
          →
        </button>
      </div>

      <WeekChart start={start} entries={entries} />

      <div className="week-total">
        Total: <strong>{formatDuration(total)}</strong>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && entries.length === 0 && (
        <p className="muted empty">No worklogs this week.</p>
      )}

      {dates.map((date) => {
        const list = byDate.get(date)!;
        const dayTotal = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
        return (
          <div key={date} className="day-group">
            <div className="day-head">
              <span>{formatDate(date)}</span>
              <span className="muted">{formatDuration(dayTotal)}</span>
            </div>
            {list.map((e) => (
              <div key={e.id} className="worklog-row">
                <div className="worklog-main">
                  <button
                    className="key-link key"
                    title={`Open ${e.issueKey} in browser`}
                    onClick={() => openUrl(`${site}/browse/${e.issueKey}`)}
                  >
                    {e.issueKey}
                  </button>
                  <span className="summary">{e.issueSummary}</span>
                  {e.comment && <span className="comment">{e.comment}</span>}
                  {!e.billable && <span className="nb-tag">non-billable</span>}
                </div>
                {e.time && <span className="wl-time">{e.time}</span>}
                <span className="duration">{formatDuration(e.timeSpentSeconds)}</span>
                <div className="worklog-actions">
                  {confirmDelete === e.id ? (
                    <>
                      <button
                        className="icon"
                        title="Cancel"
                        onClick={() => setConfirmDelete(null)}
                      >
                        ✕
                      </button>
                      <button
                        className="icon danger-icon"
                        title="Confirm delete"
                        onClick={() => remove(e)}
                      >
                        ✓
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="icon"
                        title="Log again today"
                        onClick={() => setRepeating(e)}
                      >
                        ↻
                      </button>
                      <button className="icon" title="Edit" onClick={() => setEditing(e)}>
                        ✎
                      </button>
                      <button
                        className="icon"
                        title="Delete"
                        onClick={() => setConfirmDelete(e.id)}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {editing && (
        <EditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {repeating && (
        <RepeatModal
          issueKey={repeating.issueKey}
          issueSummary={repeating.issueSummary}
          allowSaveTemplate
          initial={{
            duration: formatDuration(repeating.timeSpentSeconds),
            comment: repeating.comment,
            nonBillable: !repeating.billable,
          }}
          onClose={() => setRepeating(null)}
          onSaved={async () => {
            setRepeating(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  const label = d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return date === today() ? `${label} · Today` : label;
}

function EditModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: WorklogEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { draft, patch, seconds } = useWorklogDraft({
    duration: formatDuration(entry.timeSpentSeconds),
    date: entry.date,
    time: entry.time,
    comment: entry.comment,
    nonBillable: !entry.billable,
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
      await api.updateWorklog(
        entry.issueKey,
        entry.id,
        seconds,
        draft.date,
        draft.time,
        draft.comment,
        !draft.nonBillable,
      );
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Edit {entry.issueKey}
        </h3>
        <WorklogFields draft={draft} patch={patch} seconds={seconds} />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
