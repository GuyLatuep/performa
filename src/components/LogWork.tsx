import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { api, IssueSummary } from "../api";
import { clearForward, useBackTarget } from "../back";
import { useShortcutBadge } from "../shortcuts";
import { logInfo } from "../log";
import { formatDuration } from "../time";
import IssueHistory from "./IssueHistory";
import IssuePicker from "./IssuePicker";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  site: string;
  onLogged: () => void;
  /** Issue to open the log form for right away (e.g. picked on the start tab). */
  initialIssue?: IssueSummary | null;
  /** Name of the tab the form was opened from ("Todo", "Start", …). */
  backLabel?: string;
  /** Return to that tab. Absent on a manual visit to the log tab. */
  onBack?: () => void;
}

export default function LogWork({
  site,
  onLogged,
  initialIssue,
  backLabel,
  onBack,
}: Props) {
  const [selected, setSelected] = useState<IssueSummary | null>(
    initialIssue ?? null,
  );

  const { draft, patch, seconds } = useWorklogDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Bumped after logging so the history list below the form reloads.
  const [historyKey, setHistoryKey] = useState(0);

  /** Whichever way out the back row is offering — see the comment on it below.
   *  Null while the picker is up: that is the log tab itself, and the tab strip
   *  is how you leave a tab. */
  const cameFrom = onBack && selected === initialIssue ? backLabel : null;
  const back = useCallback(() => {
    if (onBack && selected === initialIssue) onBack();
    else setSelected(null);
  }, [onBack, selected, initialIssue]);

  const forward = useCallback(() => {
    if (selected) setSelected(selected);
  }, [selected]);

  useBackTarget(
    { label: cameFrom ?? "the issue picker", back, forward },
    selected !== null,
  );
  // Two buttons could wear it, so it goes on the one the chord would actually
  // press — which is the tab-return while that exists, and the picker otherwise.
  const backBadge = useShortcutBadge("back", selected !== null);

  function selectIssue(issue: IssueSummary) {
    clearForward();
    // Billability shouldn't leak from the previous entry.
    patch({ nonBillable: false });
    setSelected(issue);
    logInfo(`opened log-work form for ${issue.key}`);
  }

  async function submit() {
    if (!selected) return;
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.logWork(selected.key, toWorklogInput(draft, seconds));
      setOkMsg(`Logged ${formatDuration(seconds)} on ${selected.key}`);
      patch({ duration: "", comment: "", nonBillable: false });
      setHistoryKey((k) => k + 1);
      onLogged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <div className="panel">
        <div className="back-row">
          {/* Only while the issue the caller handed over is still the one on
              screen: once another issue is picked here, the log tab is where
              the user came from. */}
          {cameFrom && (
            <button className="link" {...backBadge} onClick={back}>
              <ArrowLeft size={15} strokeWidth={2} aria-hidden />
              Back to {cameFrom}
            </button>
          )}
          <button
            className="link"
            {...(cameFrom ? {} : backBadge)}
            onClick={() => setSelected(null)}
          >
            <ArrowLeft size={15} strokeWidth={2} aria-hidden />
            Choose a different issue
          </button>
        </div>
        <div className="issue-chip">
          <span className="key">{selected.key}</span>
          <span className="summary">{selected.summary}</span>
        </div>

        <WorklogFields
          draft={draft}
          patch={patch}
          seconds={seconds}
          fastTabOrder
        />

        {error && <p className="error">{error}</p>}
        {okMsg && <p className="success">{okMsg}</p>}

        <button onClick={submit} disabled={busy}>
          {busy ? "Logging…" : "Log work"}
        </button>

        <IssueHistory issueKey={selected.key} refreshKey={historyKey} />
      </div>
    );
  }

  return (
    <div className="panel">
      <IssuePicker site={site} onSelect={selectIssue} />
    </div>
  );
}
