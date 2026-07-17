import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, WorklogEntry } from "../api";
import { formatDuration, startOfWeek, today, toDateInput } from "../time";
import { useDailyHours, useShowWeekends, WORKDAYS_PER_WEEK } from "../settings";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
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

export default function Timesheet({ site, refreshKey }: Props) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorklogEntry | null>(null);
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
    </div>
  );
}

/** Per-day bars against the daily target, plus a weekly progress ring. */
function WeekChart({ start, entries }: { start: string; entries: WorklogEntry[] }) {
  const dailyHours = useDailyHours();
  const showWeekends = useShowWeekends();
  const dayTarget = dailyHours * 3600;
  const weekTarget = dayTarget * WORKDAYS_PER_WEEK;

  const startDate = new Date(start + "T00:00:00");
  const allDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return {
      date: toDateInput(d),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      seconds: 0,
    };
  });
  for (const e of entries) {
    const day = allDays.find((d) => d.date === e.date);
    if (day) day.seconds += e.timeSpentSeconds;
  }

  // Weekends are hidden by default, but a weekend day with logged time is
  // always shown so no bar silently disappears.
  const days = allDays.filter(
    (d, i) => i < WORKDAYS_PER_WEEK || showWeekends || d.seconds > 0,
  );

  const scaleMax = Math.max(dayTarget, ...days.map((d) => d.seconds), 1);
  const total = allDays.reduce((s, d) => s + d.seconds, 0);
  const pct = weekTarget > 0 ? total / weekTarget : 0;

  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.min(pct, 1) * CIRC;

  return (
    <div className="week-charts">
      <div className="day-bars">
        <div className="day-bars-plot">
          <div
            className="day-target"
            style={{ bottom: `${(dayTarget / scaleMax) * 100}%` }}
          >
            <span>{formatDuration(dayTarget)}</span>
          </div>
          {days.map((d) => (
            <div
              key={d.date}
              className="day-col"
              title={`${d.label} · ${formatDuration(d.seconds)}`}
            >
              {d.seconds > 0 && (
                <div
                  className="day-bar"
                  style={{
                    height: `${(d.seconds / scaleMax) * 100}%`,
                    minHeight: 6,
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="day-labels">
          {days.map((d) => (
            <span key={d.date} className={d.date === today() ? "today" : ""}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <div
        className="week-gauge"
        title={`${formatDuration(total)} of ${formatDuration(weekTarget)}`}
      >
        <svg viewBox="0 0 120 120" role="img" aria-label="Week progress">
          <circle className="gauge-track" cx={60} cy={60} r={R} />
          <circle
            className="gauge-edge"
            cx={60}
            cy={60}
            r={R}
            strokeDasharray={`${filled} ${CIRC - filled}`}
            transform="rotate(-90 60 60)"
          />
          <circle
            className="gauge-fill"
            cx={60}
            cy={60}
            r={R}
            strokeDasharray={`${filled} ${CIRC - filled}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="gauge-center">
          <strong>{Math.round(pct * 100)}%</strong>
          <span>of {formatDuration(weekTarget)}</span>
        </div>
      </div>
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
