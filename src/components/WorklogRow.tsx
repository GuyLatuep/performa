import { openUrl } from "@tauri-apps/plugin-opener";
import { WorklogEntry } from "../api";
import { formatDuration } from "../time";

// One booked worklog, with the three things you can do to it. Shared by the
// week ledger and the month matrix's cell drill-down, so "opens the existing
// edit UI" means the same rows and the same buttons in both.

interface Props {
  entry: WorklogEntry;
  site: string;
  /** Whether this row is currently asking whether the delete was meant. The
   *  state lives with the caller so only one row at a time can be asking. */
  confirming: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRepeat: () => void;
}

export default function WorklogRow({
  entry,
  site,
  confirming,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onEdit,
  onRepeat,
}: Props) {
  return (
    <div className="worklog-row">
      <div className="worklog-main">
        <button
          className="key-link key"
          title={`Open ${entry.issueKey} in browser`}
          onClick={() => openUrl(`${site}/browse/${entry.issueKey}`)}
        >
          {entry.issueKey}
        </button>
        <span className="summary">{entry.issueSummary}</span>
        {entry.comment && <span className="comment">{entry.comment}</span>}
        {!entry.billable && <span className="nb-tag">non-billable</span>}
      </div>
      {entry.time && <span className="wl-time">{entry.time}</span>}
      <span className="duration">{formatDuration(entry.timeSpentSeconds)}</span>
      <div className="worklog-actions">
        {confirming ? (
          <>
            <button className="icon" title="Cancel" onClick={onCancelDelete}>
              ✕
            </button>
            <button
              className="icon danger-icon"
              title="Confirm delete"
              onClick={onDelete}
            >
              ✓
            </button>
          </>
        ) : (
          <>
            <button className="icon" title="Log again today" onClick={onRepeat}>
              ↻
            </button>
            <button className="icon" title="Edit" onClick={onEdit}>
              ✎
            </button>
            <button className="icon" title="Delete" onClick={onConfirmDelete}>
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}
