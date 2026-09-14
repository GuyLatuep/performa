import { Circle, Play, Star } from "lucide-react";
import { useEffect, useRef } from "react";
import { openExternal } from "../external";
import { IssueSummary } from "../api";
import { priorityClass, shortStatus } from "../issueLabels";
import { today } from "../time";
import { togglePin } from "../pins";
import { useIssueTypeIcon } from "../issueTypeIcons";
import { useShowIssueTypeIcons } from "../settings";
import { startTimer, useTimer } from "../timer";
import { useShortcut } from "../shortcuts";

/** One issue in a selectable list: pin star, type icon, key link, summary,
 *  timer start. Shows a due-date badge when the issue carries one. */
export default function IssueRow({
  issue,
  site,
  pinned,
  lastPinned = false,
  selected = false,
  onSelect,
}: {
  issue: IssueSummary;
  site: string;
  pinned: boolean;
  lastPinned?: boolean;
  /** The keyboard is on this row. Optional and false by default, so the issue
   *  picker — where there is no selection to be on — is unaffected. */
  selected?: boolean;
  onSelect: (issue: IssueSummary) => void;
}) {
  const activeTimer = useTimer();
  const isRunning = activeTimer?.issueKey === issue.key;

  // Nothing calls `.focus()` on a row — it holds four buttons of its own and the
  // focus ring around the lot of them would compete with the selection wash for
  // the same meaning — so keeping it in view is this component's job.
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Bound only while the keyboard is on this row, which is what makes one key
  // serve two hundred of them: exactly one row is ever selected, so exactly one
  // set of these is ever registered. The badges land on this row's own buttons
  // for the same reason.
  const pinKeys = useShortcut("pin", () => togglePin(issue), selected);
  const jiraKeys = useShortcut(
    "openInJira",
    () => openExternal(`${site}/browse/${issue.key}`),
    selected,
  );
  // Starting a timer is the other half of ⌘T, and only available on the same
  // terms the button is: not while another timer is already running.
  const timerKeys = useShortcut(
    "timer",
    () => startTimer(issue.key, issue.summary),
    selected && !activeTimer,
  );

  return (
    <li
      ref={row}
      className={
        [lastPinned && "pinned-last", selected && "selected"]
          .filter(Boolean)
          .join(" ") || undefined
      }
      // Not `role="option"`: an option may hold no focusable descendants and
      // this row holds four. `aria-current` is the house idiom for "the one
      // you are on" — the nav rows already use it.
      aria-current={selected ? "true" : undefined}
    >
      <button
        {...pinKeys}
        className={`icon pin-toggle${pinned ? " pinned" : ""}`}
        title={pinned ? `Unpin ${issue.key}` : `Pin ${issue.key} to top`}
        onClick={() => togglePin(issue)}
      >
        <Star
          size={16}
          strokeWidth={1.75}
          fill={pinned ? "currentColor" : "none"}
          aria-hidden
        />
      </button>
      <TypeIcon type={issue.issueType} url={issue.issueTypeIcon} />
      <button
        {...jiraKeys}
        className="issue-open key"
        title={`Open ${issue.key} in browser`}
        onClick={() => openExternal(`${site}/browse/${issue.key}`)}
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
        {...timerKeys}
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
        {isRunning ? (
          <>
            <Circle size={11} strokeWidth={0} fill="currentColor" aria-hidden />
            timing
          </>
        ) : (
          <>
            <Play size={11} strokeWidth={0} fill="currentColor" aria-hidden />
            start
          </>
        )}
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
