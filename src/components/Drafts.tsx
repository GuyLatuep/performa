import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { api, IssueSummary } from "../api";
import {
  bookDraft,
  discardDraft,
  Draft,
  draftAgeDays,
  isStale,
  requestPark,
  useDrafts,
} from "../drafts";
import { useShortcut, useShortcutBadge } from "../shortcuts";
import { formatDayLabel, formatDuration } from "../time";
import IssueHistory from "./IssueHistory";
import IssuePicker from "./IssuePicker";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

/**
 * The drafts half of the Missing tab: time the user parked, waiting to be
 * booked. Its own section, above the scan's findings and apart from them —
 * one is a reminder somebody wrote, the other a guess the app made.
 */
export function DraftList({ onBook }: { onBook: (draft: Draft) => void }) {
  const drafts = useDrafts();
  if (drafts.length === 0) return null;
  const total = drafts.reduce((sum, d) => sum + d.seconds, 0);

  return (
    <section className="drafts" aria-label="Parked time">
      <div className="drafts-head">
        <h3>Parked time</h3>
        <span className="missing-meta">{formatDuration(total)} to book</span>
        <button className="link" onClick={() => requestPark()}>
          Park time…
        </button>
      </div>
      <ul className="draft-list">
        {drafts.map((draft) => (
          <DraftRow key={draft.id} draft={draft} onBook={() => onBook(draft)} />
        ))}
      </ul>
    </section>
  );
}

function DraftRow({ draft, onBook }: { draft: Draft; onBook: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const stale = isStale(draft);
  const when = formatDayLabel(draft.date, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <li className={`draft-row${stale ? " stale" : ""}`}>
      <span className="draft-time">{formatDuration(draft.seconds)}</span>
      <div className="draft-body">
        <span className="draft-note">
          {draft.note || draft.issueSummary || "(no note)"}
        </span>
        <span className="hint">
          {when} · {draft.time} ·{" "}
          {draft.issueKey ? (
            <span className="key">{draft.issueKey}</span>
          ) : (
            "no ticket yet"
          )}
          {!draft.billable && " · non-billable"}
          {stale && ` · waiting ${draftAgeDays(draft)} days`}
        </span>
      </div>
      {confirming ? (
        <span className="draft-actions">
          <span className="confirm-text">Discard this time?</span>
          <button className="secondary" onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button className="danger" onClick={() => discardDraft(draft.id)}>
            Discard
          </button>
        </span>
      ) : (
        <span className="draft-actions">
          <button className="link" onClick={onBook}>
            Book
          </button>
          <button className="link" onClick={() => requestPark(draft)}>
            Edit
          </button>
          <button className="link" onClick={() => setConfirming(true)}>
            Discard
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * Book a draft: pick the issue if it has none, then the ordinary log form,
 * filled in from it. Booking less than the whole leaves the rest parked.
 */
export function DraftBookForm({
  draft,
  site,
  onDone,
}: {
  draft: Draft;
  site: string;
  onDone: () => void;
}) {
  const [issue, setIssue] = useState<IssueSummary | null>(
    draft.issueKey
      ? { key: draft.issueKey, summary: draft.issueSummary }
      : null,
  );
  const {
    draft: form,
    patch,
    seconds,
  } = useWorklogDraft({
    duration: formatDuration(draft.seconds),
    date: draft.date,
    time: draft.time,
    comment: draft.note,
    nonBillable: !draft.billable,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backBadge = useShortcutBadge("back");
  const submitKeys = useShortcut("submit", () => save(), !busy && !!issue);

  async function save() {
    if (!issue) return;
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(issue.key, toWorklogInput(form, seconds));
      bookDraft(draft.id, seconds);
      onDone();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <button className="link" {...backBadge} onClick={onDone}>
        <ArrowLeft size={15} strokeWidth={2} aria-hidden />
        Back to the list
      </button>
      <p className="hint missing-reason">
        Parked {formatDuration(draft.seconds)}
        {draft.note && <>: “{draft.note}”</>}
      </p>

      {issue ? (
        <>
          <div className="issue-chip">
            <span className="key">{issue.key}</span>
            <span className="summary">{issue.summary}</span>
            <button className="link" onClick={() => setIssue(null)}>
              Change
            </button>
          </div>
          <WorklogFields
            draft={form}
            patch={patch}
            seconds={seconds}
            durationLabel="Time spent (what is left stays parked)"
          />
          {error && <p className="error">{error}</p>}
          <button {...submitKeys} onClick={save} disabled={busy}>
            {busy ? "Logging…" : "Log work"}
          </button>
          <IssueHistory issueKey={issue.key} />
        </>
      ) : (
        <IssuePicker site={site} offerPark={false} onSelect={setIssue} />
      )}
    </div>
  );
}
