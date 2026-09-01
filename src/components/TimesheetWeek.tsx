import { useCallback, useEffect, useState } from "react";
import { api, WorklogEntry } from "../api";
import { formatDayLabel, formatDuration, weekRange } from "../time";
import WeekChart from "./WeekChart";
import RepeatModal from "./RepeatModal";
import WorklogEditModal from "./WorklogEditModal";
import WorklogRow from "./WorklogRow";

interface Props {
  site: string;
  refreshKey: number;
}

// One week at a time, so the year would be noise.
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "short",
  day: "numeric",
};

export default function TimesheetWeek({ site, refreshKey }: Props) {
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
    offset === 0
      ? "This week"
      : offset === -1
        ? "Last week"
        : `${start} – ${end}`;

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
              <span>{formatDayLabel(date, DAY_FORMAT)}</span>
              <span className="muted">{formatDuration(dayTotal)}</span>
            </div>
            {list.map((e) => (
              <WorklogRow
                key={e.id}
                entry={e}
                site={site}
                confirming={confirmDelete === e.id}
                onConfirmDelete={() => setConfirmDelete(e.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() => remove(e)}
                onEdit={() => setEditing(e)}
                onRepeat={() => setRepeating(e)}
              />
            ))}
          </div>
        );
      })}

      {editing && (
        <WorklogEditModal
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
