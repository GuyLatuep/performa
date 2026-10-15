import { useState } from "react";
import { IssueSummary } from "../api";
import {
  addDraft,
  closeParkRequest,
  draftProblem,
  ParkRequest,
  updateDraft,
  useParkRequest,
} from "../drafts";
import { useShortcut } from "../shortcuts";
import { formatDuration } from "../time";
import IssuePicker from "./IssuePicker";
import { useWorklogDraft, WorklogFields } from "./WorklogFields";

/** The park form, wherever it was asked for: the palette, an empty issue
 *  search, a draft's Edit. Mounted once, by the app shell. */
export default function ParkModalHost({ site }: { site: string }) {
  const request = useParkRequest();
  if (!request) return null;
  // Keyed, so a second request starts from its own values rather than the
  // last form's leftovers.
  return <ParkModal key={request.id ?? "new"} site={site} initial={request} />;
}

function ParkModal({ site, initial }: { site: string; initial: ParkRequest }) {
  const editing = initial.id !== undefined;
  const { draft, patch, seconds } = useWorklogDraft({
    duration: initial.seconds ? formatDuration(initial.seconds) : "",
    date: initial.date,
    time: initial.time,
    comment: initial.note ?? "",
    nonBillable: initial.billable === false,
  });
  const [issue, setIssue] = useState<IssueSummary | null>(
    initial.issueKey
      ? { key: initial.issueKey, summary: initial.issueSummary ?? "" }
      : null,
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitKeys = useShortcut("submit", () => save(), !picking);

  function save() {
    const input = {
      seconds: seconds ?? 0,
      date: draft.date,
      time: draft.time,
      note: draft.comment,
      issueKey: issue?.key ?? null,
      issueSummary: issue?.summary ?? "",
      billable: !draft.nonBillable,
    };
    const problem = draftProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    if (initial.id !== undefined) updateDraft(initial.id, input);
    else addDraft(input);
    closeParkRequest();
  }

  return (
    // No backdrop-click close: a half-written note is exactly the kind of
    // thing this form exists to keep.
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Park time"
      >
        <h3>{editing ? "Edit draft" : "Park time"}</h3>
        <p className="muted modal-sub">
          Time you will book later — say what it was, and the issue once there
          is one.
        </p>

        {picking ? (
          <>
            <IssuePicker
              site={site}
              offerPark={false}
              onSelect={(picked) => {
                setIssue(picked);
                setPicking(false);
              }}
            />
            <button
              type="button"
              className="link"
              onClick={() => setPicking(false)}
            >
              Not now
            </button>
          </>
        ) : (
          <>
            <div className="draft-issue">
              {issue ? (
                <>
                  <span className="issue-chip">
                    <span className="key">{issue.key}</span>
                    <span className="summary">{issue.summary}</span>
                  </span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setIssue(null)}
                  >
                    No issue
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="link"
                  onClick={() => setPicking(true)}
                >
                  Pick the issue (optional)
                </button>
              )}
            </div>

            <WorklogFields
              draft={draft}
              patch={patch}
              seconds={seconds}
              commentLabel={issue ? "Note (optional)" : "Note — what was it?"}
            />

            {error && <p className="error">{error}</p>}

            <div className="row">
              <button className="secondary" onClick={closeParkRequest}>
                Cancel
              </button>
              <button {...submitKeys} onClick={save}>
                {editing ? "Save draft" : "Park it"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
