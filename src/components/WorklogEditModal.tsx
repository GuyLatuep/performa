import { useState } from "react";
import { api, WorklogEntry } from "../api";
import { formatDuration } from "../time";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

/** Change an existing worklog: the same duration/date/time/comment fields the
 *  log form uses, saved over the entry it was opened on. */
export default function WorklogEditModal({
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
        toWorklogInput(draft, seconds),
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
        <h3>Edit {entry.issueKey}</h3>
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
