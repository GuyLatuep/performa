import { useCallback, useEffect, useState } from "react";
import { api, WorklogEntry } from "../api";
import { formatDuration, parseDuration, startOfWeek, today, toDateInput } from "../time";

interface Props {
  refreshKey: number;
}

function weekRange(offsetWeeks: number): { start: string; end: string } {
  const now = new Date();
  now.setDate(now.getDate() + offsetWeeks * 7);
  const start = startOfWeek(now);
  const startDate = new Date(start);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  return { start, end: toDateInput(endDate) };
}

export default function Timesheet({ refreshKey }: Props) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorklogEntry | null>(null);

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
    if (!confirm(`Delete ${formatDuration(entry.timeSpentSeconds)} on ${entry.issueKey}?`)) {
      return;
    }
    try {
      await api.deleteWorklog(entry.issueKey, entry.id);
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
                  <span className="key">{e.issueKey}</span>
                  <span className="summary">{e.issueSummary}</span>
                  {e.comment && <span className="comment">{e.comment}</span>}
                </div>
                {e.time && <span className="wl-time">{e.time}</span>}
                <span className="duration">{formatDuration(e.timeSpentSeconds)}</span>
                <div className="worklog-actions">
                  <button className="icon" title="Edit" onClick={() => setEditing(e)}>
                    ✎
                  </button>
                  <button className="icon" title="Delete" onClick={() => remove(e)}>
                    🗑
                  </button>
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
  const [duration, setDuration] = useState(formatDuration(entry.timeSpentSeconds));
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState(entry.time);
  const [comment, setComment] = useState(entry.comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const seconds = parseDuration(duration);
    if (seconds === null) {
      setError("Enter a valid duration, e.g. 1h 30m");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateWorklog(entry.issueKey, entry.id, seconds, date, time, comment);
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
        <label>
          Time spent
          <input value={duration} onChange={(e) => setDuration(e.target.value)} autoFocus />
        </label>
        <div className="field-row">
          <label>
            Date
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Start time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label>
          Comment
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
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
