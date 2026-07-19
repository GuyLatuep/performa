import { openUrl } from "@tauri-apps/plugin-opener";
import { IssueSummary } from "../api";
import { today } from "../time";
import { togglePin } from "../pins";
import { startTimer, useTimer } from "../timer";

/** One issue in a selectable list: pin star, key link, summary, timer start.
 *  Shows a due-date badge when the issue carries one. */
export default function IssueRow({
  issue,
  site,
  pinned,
  lastPinned = false,
  onSelect,
}: {
  issue: IssueSummary;
  site: string;
  pinned: boolean;
  lastPinned?: boolean;
  onSelect: (issue: IssueSummary) => void;
}) {
  const activeTimer = useTimer();
  const isRunning = activeTimer?.issueKey === issue.key;
  return (
    <li className={lastPinned ? "pinned-last" : undefined}>
      <button
        className={`icon pin-toggle${pinned ? " pinned" : ""}`}
        title={pinned ? `Unpin ${issue.key}` : `Pin ${issue.key} to top`}
        onClick={() => togglePin(issue)}
      >
        {pinned ? "★" : "☆"}
      </button>
      <button
        className="issue-open key"
        title={`Open ${issue.key} in browser`}
        onClick={() => openUrl(`${site}/browse/${issue.key}`)}
      >
        {issue.key}
      </button>
      <button className="issue-select" onClick={() => onSelect(issue)}>
        <span className="summary">{issue.summary}</span>
      </button>
      {issue.dueDate && <DueBadge date={issue.dueDate} />}
      <button
        className={`timer-start${isRunning ? " running" : ""}`}
        disabled={!!activeTimer}
        title={
          isRunning
            ? "Timer running"
            : activeTimer
              ? "Stop the running timer first"
              : `Start timer for ${issue.key}`
        }
        onClick={() => startTimer(issue.key, issue.summary)}
      >
        {isRunning ? "● timing" : "▶ start"}
      </button>
    </li>
  );
}

function DueBadge({ date }: { date: string }) {
  const now = today();
  const state = date < now ? " overdue" : date === now ? " due-today" : "";
  const label =
    date === now
      ? "today"
      : new Date(date + "T00:00:00").toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
  return (
    <span className={`due-badge${state}`} title={`Due ${date}`}>
      {date < now ? "overdue · " : "due "}
      {label}
    </span>
  );
}
