import { useState } from "react";
import { api } from "../api";
import { addTemplate } from "../templates";
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
  /** Offer a "save as template" checkbox alongside logging. */
  allowSaveTemplate?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Log a fresh worklog based on a previous entry or template. */
export default function RepeatModal({
  issueKey,
  issueSummary,
  initial,
  allowSaveTemplate = false,
  onClose,
  onSaved,
}: Props) {
  const { draft, patch, seconds } = useWorklogDraft(initial);
  const [saveTemplate, setSaveTemplate] = useState(false);
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
      if (saveTemplate) {
        addTemplate({
          issueKey,
          issueSummary,
          duration: draft.duration,
          comment: draft.comment,
          nonBillable: draft.nonBillable,
        });
      }
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
        {allowSaveTemplate && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={saveTemplate}
              onChange={(e) => setSaveTemplate(e.target.checked)}
            />
            Save as template on the start tab
          </label>
        )}
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
