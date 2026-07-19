import { useState } from "react";
import { api } from "../api";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  issueKey: string;
  issueSummary: string;
  /** Prefill (duration/comment/billability); date and time default to now. */
  initial: Partial<WorklogDraft>;
  onClose: () => void;
  onSaved: () => void;
}

/** Log a fresh worklog based on a previous entry or template. */
export default function RepeatModal({
  issueKey,
  issueSummary,
  initial,
  onClose,
  onSaved,
}: Props) {
  const { draft, patch, seconds } = useWorklogDraft(initial);
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
        issueKey,
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Log again — {issueKey}</h3>
        <p className="muted modal-sub">{issueSummary}</p>
        <WorklogFields draft={draft} patch={patch} seconds={seconds} />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save} disabled={busy}>
            {busy ? "Logging…" : "Log work"}
          </button>
        </div>
      </div>
    </div>
  );
}
