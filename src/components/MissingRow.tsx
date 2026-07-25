import { openUrl } from "@tauri-apps/plugin-opener";
import { MissingWorklog } from "../api";
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
}: Props) {
  return (
    <div className="worklog-row">
      <div className="worklog-main">
        <button
          className="key-link key"
          title={`Open ${item.issueKey} in browser`}
          onClick={() => openUrl(`${site}/browse/${item.issueKey}`)}
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
              → logs on {item.logKey} · {item.logSummary}
            </span>
          )}
        </button>
      </div>
      <span className="missing-meta">
        {item.kind === "comment" ? "commented" : "status changed"}{" "}
        {timeAgo(item.activityAt)}
      </span>
    </div>
  );
}

/** Stable list key for a flagged activity — an issue can appear again with a
 *  later activity, so the key has to cover both. */
export const missingRowKey = (item: MissingWorklog) =>
  `${item.issueKey}-${item.activityAt}`;
