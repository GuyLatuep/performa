import { useState } from "react";
import { api } from "../api";
import { formatDuration } from "../time";
import { logInfo } from "../log";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

/** The log-work form from the log tab, filing against the open issue. */
export default function LogPanel({
  issueKey,
  onLogged,
}: {
  issueKey: string;
  onLogged: () => void;
}) {
  const { draft, patch, seconds } = useWorklogDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(issueKey, toWorklogInput(draft, seconds));
      logInfo(`logged ${formatDuration(seconds)} on ${issueKey}`);
      patch({ duration: "", comment: "", nonBillable: false });
      // No success message: the panel closes and the new worklog appears on
      // the timeline, which says the same thing and is harder to disbelieve.
      onLogged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="action-panel">
      <WorklogFields draft={draft} patch={patch} seconds={seconds} />
      {error && <p className="error">{error}</p>}
      <div className="comment-actions">
        <button onClick={submit} disabled={busy}>
          {busy ? "Logging…" : "Log work"}
        </button>
      </div>
    </div>
  );
}
