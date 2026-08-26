import { openUrl } from "@tauri-apps/plugin-opener";
import { IssueSummary } from "../api";
import { priorityClass, shortStatus } from "../issueLabels";
import { today } from "../time";
import { togglePin } from "../pins";
import { useIssueTypeIcon } from "../issueTypeIcons";
import { useShowIssueTypeIcons } from "../settings";
import { startTimer, useTimer } from "../timer";

/** One issue in a selectable list: pin star, type icon, key link, summary,
 *  timer start. Shows a due-date badge when the issue carries one. */
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
      <TypeIcon type={issue.issueType} url={issue.issueTypeIcon} />
      <button
        className="issue-open key"
        title={`Open ${issue.key} in browser`}
        onClick={() => openUrl(`${site}/browse/${issue.key}`)}
      >
        {issue.key}
      </button>
      {/* The summary column is ellipsised (one line per row), so the full text
          only exists in the tooltip — the narrower the window, the more of it
          is cut off. */}
      <button
        className="issue-select"
        title={issue.summary}
        onClick={() => onSelect(issue)}
      >
        <span className="summary">{issue.summary}</span>
      </button>
      {issue.priority && (
        <span
          className={`priority-badge ${priorityClass(issue.priority)}`}
          title={`Priority: ${issue.priority}`}
        >
          {issue.priority}
        </span>
      )}
      {issue.status && (
        <span className="status-badge" title={`Status: ${issue.status}`}>
          {shortStatus(issue.status)}
        </span>
      )}
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

/** Jira's own icon for the issue's type.
 *
 *  The cell is drawn whether or not there is an icon in it — while one is being
 *  fetched, when a type carries none, and on a list that didn't ask for the
 *  type at all. An empty box of the same size is what keeps a late-arriving
 *  icon from shifting the row it lands in.
 *
 *  Like `DueBadge`, the name is in the tooltip rather than beside the mark: the
 *  column earns its width by staying narrow. Turned off in Appearance, the cell
 *  goes away entirely rather than sitting there empty. */
function TypeIcon({ type, url }: { type?: string; url?: string }) {
  const shown = useShowIssueTypeIcons();
  // Nothing is fetched while the setting is off — the cell isn't drawn, so an
  // icon for it would be a request for something nobody can see.
  const icon = useIssueTypeIcon(shown ? url : undefined);
  if (!shown) return null;
  return (
    <span className="type-icon" title={type ? `Type: ${type}` : undefined}>
      {icon && <img src={icon} alt={type ?? ""} />}
    </span>
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
