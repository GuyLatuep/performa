import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, IssueSummary, WorklogEntry } from "../api";
import {
  buildMonthGrid,
  MonthColumn,
  MonthRow,
  rowOrderOf,
} from "../monthGrid";
import {
  formatDayLabel,
  formatDuration,
  monthLabel,
  monthRange,
  today,
  weekChunks,
} from "../time";
import IssuePicker from "./IssuePicker";
import RepeatModal from "./RepeatModal";
import WorklogEditModal from "./WorklogEditModal";
import WorklogRow from "./WorklogRow";

interface Props {
  site: string;
  refreshKey: number;
}

// The month as a matrix: issues down the side, days across the top, hours in
// the cells. It is a map of where the time went, and every cell is a way in:
// clicking one opens that issue's bookings for that day, to read, change, or
// add to.

/** How many of the month's weeks to fetch at once. Each one costs a search
 *  plus a worklog read per issue it finds, sixteen at a time inside the
 *  backend — six weeks let loose together is a hundred-odd concurrent requests
 *  and an invitation to be rate-limited. */
const FETCH_CONCURRENCY = 2;

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "short",
  day: "numeric",
};

/** How a day's total reads at a glance. The thresholds are about an ordinary
 *  working day, which is why they are only applied to one: a weekend is not
 *  expected to be full, and a day that hasn't happened yet is not behind. */
const THIN_HOURS = 3;
const FULL_HOURS = 6;

function dayTone(seconds: number, col: MonthColumn): string {
  if (col.future || col.weekend) return "";
  const hours = seconds / 3600;
  if (hours > FULL_HOURS) return " tone-full";
  if (hours >= THIN_HOURS) return " tone-part";
  return " tone-thin";
}

/** Hours as the grid shows them: "1.5", "0.25", "2". A column is barely wide
 *  enough for four characters, which "1h 30m" is not — the full duration is in
 *  the cell's tooltip instead. */
function decimalHours(seconds: number): string {
  return (seconds / 3600).toFixed(2).replace(/\.?0+$/, "") || "0";
}

export default function TimesheetMonth({ site, refreshKey }: Props) {
  const [offset, setOffset] = useState(0);
  /** Bumped to load the same month again — what Retry does after a week of it
   *  failed. Setting the offset to the value it already holds changes nothing. */
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Weeks whose fetch failed. The rest of the month is still worth showing,
   *  so this is a warning above the grid and not a replacement for it. */
  const [failed, setFailed] = useState<string[]>([]);
  /** Fixed at load time so an edit that changes a total doesn't reorder the
   *  table under the cursor. See `buildMonthGrid`. */
  const [rowOrder, setRowOrder] = useState<string[]>([]);

  const [openCell, setOpenCell] = useState<{
    issueKey: string;
    date: string;
  } | null>(null);
  const [quickLog, setQuickLog] = useState<string | null>(null);

  const { start, end } = monthRange(offset);

  // Whole weeks rather than one month-wide read: it reuses the per-week reads
  // the week view and the start tab already have cached, keeps each search
  // inside the backend's single result page, and lets the grid fill in as the
  // weeks land instead of after all of them.
  useEffect(() => {
    let cancelled = false;
    const queue = weekChunks(start, end);
    setLoading(true);
    setError(null);
    setFailed([]);
    setEntries([]);

    const collected: WorklogEntry[] = [];
    const missed: string[] = [];

    async function worker() {
      for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
        try {
          const got = await api.listWorklogs(chunk.start, chunk.end);
          if (cancelled) return;
          collected.push(...got);
          setEntries(dedupe(collected));
        } catch (err) {
          if (cancelled) return;
          missed.push(chunk.start);
          setError(String(err));
        }
      }
    }

    Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker())).then(
      () => {
        if (cancelled) return;
        setFailed(missed);
        setRowOrder(rowOrderOf(buildMonthGrid(collected, start, end)));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [start, end, reloadKey]);

  /** Re-read the one week a date falls in and swap it into the month.
   *
   *  A write only ever moves a single day, so refetching the whole month for
   *  it would be five wasted round trips. It is also what fills in a freshly
   *  created worklog's id, which the next edit of that cell needs. */
  const refreshChunk = useCallback(async (date: string) => {
    const [chunk] = weekChunks(date, date);
    const got = await api.listWorklogs(chunk.start, chunk.end);
    setEntries((prev) => [
      ...prev.filter((e) => e.date < chunk.start || e.date > chunk.end),
      ...got,
    ]);
  }, []);

  // A worklog filed anywhere else in the app can only have landed on today, so
  // a global refresh costs one week rather than the whole month — and nothing
  // at all when the month on screen is not the current one.
  const seenRefresh = useRef(refreshKey);
  useEffect(() => {
    if (seenRefresh.current === refreshKey) return;
    seenRefresh.current = refreshKey;
    const now = today();
    if (now >= start && now <= end) refreshChunk(now).catch(() => {});
  }, [refreshKey, start, end, refreshChunk]);

  const grid = buildMonthGrid(entries, start, end, rowOrder);
  // Looked up per render rather than held in state: the drill-down edits the
  // worklogs it lists, and a row captured when it opened would go on showing
  // the ones from before the edit.
  const openRow = openCell
    ? grid.rows.find((r) => r.issueKey === openCell.issueKey)
    : undefined;

  return (
    <div className="panel">
      <div className="week-nav">
        <button className="secondary" onClick={() => setOffset(offset - 1)}>
          ← Previous
        </button>
        <div className="week-label">
          <span>{monthLabel(start)}</span>
          <span className="muted">
            {start} – {end}
          </span>
        </div>
        <button
          className="secondary"
          onClick={() => setOffset(offset + 1)}
          disabled={offset >= 0}
        >
          Next →
        </button>
      </div>

      <div className="week-total">
        Total: <strong>{formatDuration(grid.total)}</strong>
      </div>

      {failed.length > 0 && (
        <p className="error">
          {failed.length === 1
            ? `The week of ${failed[0]} could not be loaded — its time is missing from the totals.`
            : `${failed.length} weeks could not be loaded — their time is missing from the totals.`}{" "}
          <button className="link" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </p>
      )}
      {error && failed.length === 0 && !loading && (
        <p className="error">{error}</p>
      )}
      {loading && <p className="muted">Loading…</p>}

      <div className="month-scroll">
        <div
          className="month-grid"
          role="table"
          style={{ "--month-cols": grid.columns.length } as React.CSSProperties}
        >
          <div className="month-row" role="row">
            <div className="corner col-issue row-head" role="columnheader">
              {formatDuration(grid.total)}
            </div>
            {grid.columns.map((col) => (
              <DayHeader
                key={col.date}
                col={col}
                seconds={grid.dayTotals.get(col.date) ?? 0}
              />
            ))}
            <div className="row-head col-total" role="columnheader">
              Total
            </div>
          </div>

          <div className="month-row quick-row" role="row">
            <div className="col-issue" role="rowheader">
              ＋ Log time
            </div>
            {grid.columns.map((col) => (
              <button
                key={col.date}
                type="button"
                className={`month-cell quick-cell${col.future ? " future" : ""}${
                  col.weekend ? " wknd" : ""
                }`}
                disabled={col.future}
                title={
                  col.future
                    ? "Not yet"
                    : `Log time on ${formatDayLabel(col.date, DAY_FORMAT)}`
                }
                onClick={() => setQuickLog(col.date)}
              >
                ＋
              </button>
            ))}
            <div className="col-total" role="cell" />
          </div>

          {grid.rows.map((row) => (
            <div className="month-row" role="row" key={row.issueKey}>
              <div className="col-issue" role="rowheader">
                <button
                  className="key-link key"
                  title={`Open ${row.issueKey} in browser`}
                  onClick={() => openUrl(`${site}/browse/${row.issueKey}`)}
                >
                  {row.issueKey}
                </button>
                <span className="summary" title={row.issueSummary}>
                  {row.issueSummary}
                </span>
              </div>
              {grid.columns.map((col) => {
                const cell = row.cells.get(col.date);
                const count = cell?.entries.length ?? 0;
                const seconds = cell?.seconds ?? 0;
                return (
                  <button
                    key={col.date}
                    type="button"
                    data-count={count}
                    className={
                      "month-cell" +
                      (col.weekend ? " wknd" : "") +
                      (col.isToday ? " today" : "") +
                      (col.future ? " future" : "") +
                      (count > 1 ? " cell-multi" : "")
                    }
                    disabled={col.future}
                    title={cellTitle(count, seconds, col)}
                    onClick={() =>
                      setOpenCell({ issueKey: row.issueKey, date: col.date })
                    }
                  >
                    {seconds > 0 ? decimalHours(seconds) : ""}
                  </button>
                );
              })}
              <div className="col-total" role="cell">
                {decimalHours(row.total)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!loading && grid.rows.length === 0 && (
        <p className="muted empty">
          No time logged this month — click a day in the top row to log some.
        </p>
      )}

      {openRow && openCell && (
        <CellWorklogsModal
          row={openRow}
          date={openCell.date}
          site={site}
          onClose={() => setOpenCell(null)}
          onChanged={() => refreshChunk(openCell.date)}
        />
      )}

      {quickLog && (
        <QuickLogModal
          site={site}
          date={quickLog}
          onClose={() => setQuickLog(null)}
          onSaved={async () => {
            const date = quickLog;
            setQuickLog(null);
            await refreshChunk(date);
          }}
        />
      )}
    </div>
  );
}

function cellTitle(count: number, seconds: number, col: MonthColumn): string {
  const day = formatDayLabel(col.date, DAY_FORMAT);
  if (col.future) return `${day} — not yet`;
  if (count === 0) return `${day} — nothing booked, click to log`;
  if (count === 1) return `${day} — ${formatDuration(seconds)}, click to open`;
  return `${day} — ${formatDuration(seconds)} over ${count} worklogs, click to open them`;
}

function DayHeader({ col, seconds }: { col: MonthColumn; seconds: number }) {
  const date = new Date(col.date + "T00:00:00");
  return (
    <div
      className={
        "row-head day-head-cell" +
        (col.weekend ? " wknd" : "") +
        (col.isToday ? " today" : "") +
        (col.future ? " future" : "")
      }
      role="columnheader"
      title={formatDayLabel(col.date, DAY_FORMAT)}
    >
      <span className="dow">
        {date.toLocaleDateString(undefined, { weekday: "narrow" })}
      </span>
      <span className="dom">{date.getDate()}</span>
      <span className={`day-sum${dayTone(seconds, col)}`}>
        {seconds > 0 ? decimalHours(seconds) : "0"}
      </span>
    </div>
  );
}

/** Everything booked on one issue on one day, and the way to book more.
 *
 *  Every cell opens this, empty ones included: the grid says where the time
 *  went, and this is where it is actually changed. The rows are the week
 *  view's own, so a worklog is edited, repeated and deleted the same way
 *  wherever it is met. */
function CellWorklogsModal({
  row,
  date,
  site,
  onClose,
  onChanged,
}: {
  row: MonthRow;
  date: string;
  site: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<WorklogEntry | null>(null);
  const [repeating, setRepeating] = useState<WorklogEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = row.cells.get(date)?.entries ?? [];

  async function remove(entry: WorklogEntry) {
    setConfirmDelete(null);
    try {
      await api.deleteWorklog(entry.issueKey, entry.id);
      await onChanged();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>
          {row.issueKey} · {formatDayLabel(date, DAY_FORMAT)}
        </h3>
        <p className="modal-sub">{row.issueSummary}</p>
        {error && <p className="error">{error}</p>}
        {entries.length === 0 && (
          <p className="muted empty">Nothing booked here yet.</p>
        )}
        {entries.map((entry) => (
          <WorklogRow
            key={entry.id}
            entry={entry}
            site={site}
            confirming={confirmDelete === entry.id}
            onConfirmDelete={() => setConfirmDelete(entry.id)}
            onCancelDelete={() => setConfirmDelete(null)}
            onDelete={() => remove(entry)}
            onEdit={() => setEditing(entry)}
            onRepeat={() => setRepeating(entry)}
          />
        ))}
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
          <button onClick={() => setAdding(true)}>＋ Add time</button>
        </div>

        {adding && (
          <RepeatModal
            issueKey={row.issueKey}
            issueSummary={row.issueSummary}
            title={`Log time — ${row.issueKey}`}
            // The day the cell is on, not today: the whole reason for opening
            // a cell three weeks back is to book against that day.
            initial={{ date }}
            onClose={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await onChanged();
            }}
          />
        )}
        {editing && (
          <WorklogEditModal
            entry={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await onChanged();
            }}
          />
        )}
        {repeating && (
          <RepeatModal
            issueKey={repeating.issueKey}
            issueSummary={repeating.issueSummary}
            initial={{
              duration: formatDuration(repeating.timeSpentSeconds),
              comment: repeating.comment,
              nonBillable: !repeating.billable,
            }}
            onClose={() => setRepeating(null)}
            onSaved={async () => {
              setRepeating(null);
              await onChanged();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Log time on a day for an issue that has no row yet: pick the issue, then
 *  fill in the usual form with the day already set. */
function QuickLogModal({
  site,
  date,
  onClose,
  onSaved,
}: {
  site: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [issue, setIssue] = useState<IssueSummary | null>(null);

  if (issue)
    return (
      <RepeatModal
        issueKey={issue.key}
        issueSummary={issue.summary}
        title={`Log time — ${issue.key}`}
        initial={{ date }}
        // Back to the picker rather than out of the dialog: picking the wrong
        // issue is the likely reason for closing this.
        onClose={() => setIssue(null)}
        onSaved={onSaved}
      />
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Log time · {formatDayLabel(date, DAY_FORMAT)}</h3>
        <IssuePicker site={site} onSelect={setIssue} />
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Whole weeks overlap at the month's edges, and a refetched week is merged
 *  over what was there — either way the same worklog can arrive twice. */
function dedupe(entries: WorklogEntry[]): WorklogEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return [...byId.values()];
}
