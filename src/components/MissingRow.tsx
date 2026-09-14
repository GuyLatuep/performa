import { CornerDownRight, X } from "lucide-react";
import { openExternal } from "../external";
import { useEffect, useRef } from "react";
import { MissingWorklog } from "../api";
import { useShortcut } from "../shortcuts";
import { timeAgo } from "../time";

interface Props {
  item: MissingWorklog;
  site: string;
  /** Tooltip of the row's main button — what clicking it will do. */
  actionTitle: string;
  onAction: () => void;
  /** Name the issue the time goes on when it isn't the flagged one. Shown on
   *  the dedicated tab, where the user is about to log; the start tab's
   *  overview stays terse. */
  showLogTarget?: boolean;
  /** Wave this finding away. Given by the dedicated tab only — the start tab's
   *  overview is a summary, and dismissing belongs where the list is worked. */
  onIgnore?: () => void;
  /** The keyboard is on this row. False by default, for the hosts that have no
   *  selection at all. */
  selected?: boolean;
}

/** One flagged activity: issue key linking out to Jira, a click target for
 *  the surrounding view's action, and how long ago it happened. Shared by the
 *  missing-worklog tab and the start tab's summary of it. */
export default function MissingRow({
  item,
  site,
  actionTitle,
  onAction,
  showLogTarget = false,
  onIgnore,
  selected = false,
}: Props) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Only the selected row binds, and only one row in the app is selected.
  const jiraKeys = useShortcut(
    "openInJira",
    () => openExternal(`${site}/browse/${item.issueKey}`),
    selected,
  );

  return (
    <div
      ref={row}
      className={`worklog-row${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="worklog-main">
        <button
          {...jiraKeys}
          className="key-link key"
          title={`Open ${item.issueKey} in browser`}
          onClick={() => openExternal(`${site}/browse/${item.issueKey}`)}
        >
          {item.issueKey}
        </button>
        <button
          className="issue-select missing-select"
          title={actionTitle}
          onClick={onAction}
        >
          <span className="summary">{item.issueSummary}</span>
          {item.detail && (
            <span className="comment">
              {item.kind === "comment" ? `“${item.detail}”` : item.detail}
            </span>
          )}
          {showLogTarget && item.logKey !== item.issueKey && (
            <span className="comment">
              <CornerDownRight size={13} strokeWidth={2} aria-hidden />
              logs on {item.logKey} · {item.logSummary}
            </span>
          )}
        </button>
      </div>
      <span className="missing-meta">
        {item.kind === "comment" ? "commented" : "status changed"}{" "}
        {timeAgo(item.activityAt)}
      </span>
      {onIgnore && (
        <button
          className="icon"
          title="Ignore until this issue sees newer activity"
          onClick={onIgnore}
        >
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Stable list key for a flagged activity — an issue can appear again with a
 *  later activity, so the key has to cover both. */
export const missingRowKey = (item: MissingWorklog) =>
  `${item.issueKey}-${item.activityAt}`;
