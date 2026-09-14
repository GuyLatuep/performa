import { Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { openExternal } from "../external";
import { useEffect, useRef } from "react";
import { WorklogEntry } from "../api";
import { useShortcut } from "../shortcuts";
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
  /** The keyboard is on this row. False by default, so the month matrix's cell
   *  drill-down — which has no selection — is unaffected. */
  selected?: boolean;
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
  selected = false,
}: Props) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // The three things this row offers, on the keys those verbs carry everywhere
  // else. Deleting is deliberately not among them: it is two-step and
  // irreversible, and a half-designed keyboard path to it is worse than none —
  // the ✕ and ✓ buttons remain the way.
  const editKeys = useShortcut("edit", onEdit, selected);
  const repeatKeys = useShortcut("logAgain", onRepeat, selected);
  const jiraKeys = useShortcut(
    "openInJira",
    () => openExternal(`${site}/browse/${entry.issueKey}`),
    selected,
  );

  return (
    <div
      ref={row}
      className={`worklog-row${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="worklog-main">
        <button
          {...jiraKeys}
          className="key-link key"
          title={`Open ${entry.issueKey} in browser`}
          onClick={() => openExternal(`${site}/browse/${entry.issueKey}`)}
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
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              className="icon danger-icon"
              title="Confirm delete"
              onClick={onDelete}
            >
              <Check size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <button
              {...repeatKeys}
              className="icon"
              title="Log again today"
              onClick={onRepeat}
            >
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              {...editKeys}
              className="icon"
              title="Edit"
              onClick={onEdit}
            >
              <Pencil size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button className="icon" title="Delete" onClick={onConfirmDelete}>
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
