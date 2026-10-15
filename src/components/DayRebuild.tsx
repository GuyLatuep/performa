import { useEffect, useState } from "react";
import { DayEvidence, WorklogEntry } from "../api";
import { useDrafts } from "../drafts";
import { dayTimeline, loadDayActivity, TimelineItem } from "../rebuild";
import { formatDayLabel, formatDuration, toTimeInput } from "../time";
import { useTimer } from "../timer";
import { dayInfo, useWorkCalendar } from "../workdays";
import RepeatModal from "./RepeatModal";

interface Props {
  /** yyyy-MM-dd. */
  date: string;
  /** The worklogs the caller already holds; those of other days are ignored. */
  worklogs: WorklogEntry[];
  onClose: () => void;
  /** A worklog was filed from here — the caller reloads what it shows. */
  onLogged: () => void;
}

const EVIDENCE_LABEL: Record<DayEvidence["kind"], string> = {
  comment: "You commented",
  status: "You moved it",
  created: "You created it",
  assigned: "Handed to you",
};

/**
 * One day, rebuilt from the evidence: what the user did in Jira, the running
 * timer and parked drafts, next to what is already booked. Anything on an
 * issue with nothing booked that day is offered for logging — through the
 * ordinary form, filled in with that issue and that moment. Nothing is booked
 * without the user saying so.
 */
export default function DayRebuild({
  date,
  worklogs,
  onClose,
  onLogged,
}: Props) {
  const [evidence, setEvidence] = useState<DayEvidence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<DayEvidence | null>(null);
  const timer = useTimer();
  const drafts = useDrafts();
  const calendar = useWorkCalendar();

  useEffect(() => {
    let current = true;
    loadDayActivity(date).then(
      (found) => current && setEvidence(found),
      (err) => current && setError(String(err)),
    );
    return () => {
      current = false;
    };
  }, [date]);

  const info = dayInfo(date, calendar);
  const booked = worklogs
    .filter((w) => w.date === date)
    .reduce((sum, w) => sum + w.timeSpentSeconds, 0);
  const items = evidence
    ? dayTimeline(date, { evidence, worklogs, timer, drafts })
    : [];
  const unlogged = items.filter((i) => i.kind === "evidence" && !i.logged);

  return (
    <div className="modal-backdrop">
      <div className="modal rebuild" role="dialog" aria-label="Rebuild the day">
        <h3>
          {formatDayLabel(date, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h3>
        <p className="muted modal-sub">
          {formatDuration(booked)} booked
          {info.target > 0 && ` of ${formatDuration(info.target)}`}
          {info.label && ` · ${info.label}`}
          {evidence &&
            (unlogged.length > 0
              ? ` · ${unlogged.length} thing${unlogged.length === 1 ? "" : "s"} you did with no time booked`
              : " · everything you did has time on it")}
        </p>

        {error && <p className="error">{error}</p>}
        {!evidence && !error && <p className="muted">Reading the day…</p>}
        {evidence && items.length === 0 && (
          <p className="muted empty">Nothing found for this day.</p>
        )}

        <ol className="rebuild-list">
          {items.map((item, i) => (
            <Row key={i} item={item} onLog={setLogging} />
          ))}
        </ol>

        <div className="row">
          <button onClick={onClose}>Done</button>
        </div>
      </div>

      {logging && (
        <RepeatModal
          issueKey={logging.issueKey}
          issueSummary={logging.issueSummary}
          title={`Log time — ${logging.issueKey}`}
          initial={{
            date,
            time: toTimeInput(new Date(logging.at)),
          }}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            onLogged();
          }}
        />
      )}
    </div>
  );
}

function Row({
  item,
  onLog,
}: {
  item: TimelineItem;
  onLog: (e: DayEvidence) => void;
}) {
  switch (item.kind) {
    case "worklog":
      return (
        <li className="rebuild-row booked">
          <span className="rebuild-at">{item.at}</span>
          <span className="rebuild-what">
            <span className="key">{item.entry.issueKey}</span> booked{" "}
            {formatDuration(item.entry.timeSpentSeconds)}
            {item.entry.comment && (
              <span className="hint"> — {item.entry.comment}</span>
            )}
          </span>
        </li>
      );
    case "evidence":
      return (
        <li className={`rebuild-row${item.logged ? "" : " gap"}`}>
          <span className="rebuild-at">{item.at}</span>
          <span className="rebuild-what">
            {EVIDENCE_LABEL[item.evidence.kind]} on{" "}
            <span className="key">{item.evidence.issueKey}</span>
            <span className="hint">
              {" "}
              — {item.evidence.detail || item.evidence.issueSummary}
            </span>
          </span>
          {item.logged ? (
            <span className="hint">booked</span>
          ) : (
            <button className="link" onClick={() => onLog(item.evidence)}>
              Log…
            </button>
          )}
        </li>
      );
    case "timer":
      return (
        <li className="rebuild-row">
          <span className="rebuild-at">{item.at}</span>
          <span className="rebuild-what">
            Timer on <span className="key">{item.issueKey ?? "no ticket"}</span>
            , {formatDuration(item.seconds)} so far
          </span>
        </li>
      );
    case "draft":
      return (
        <li className="rebuild-row">
          <span className="rebuild-at">{item.at}</span>
          <span className="rebuild-what">
            Parked {formatDuration(item.draft.seconds)}
            <span className="hint">
              {" "}
              — {item.draft.note || item.draft.issueKey} (book it on the Missing
              tab)
            </span>
          </span>
        </li>
      );
  }
}
