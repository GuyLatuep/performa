import { IssueActivity } from "../api";
import { statusChangeLabel, timeline, TimelineEntry } from "../activity";
import { formatDuration, timeAgo } from "../time";

export default function IssueTimeline({
  activity,
}: {
  activity: IssueActivity;
}) {
  const entries = timeline(activity);
  if (entries.length === 0)
    return <p className="muted empty">Nothing has happened on this issue.</p>;
  return (
    <>
      {/* Above the list, for the same reason the mentions tab says so above
          its own: a timeline that looks complete when it is not is worse than
          one that admits the gap. */}
      {activity.commentsTruncated && (
        <p className="hint">
          Only the newest comments are shown — this issue has more than fit in
          one page. Open it in Jira for the full history.
        </p>
      )}
      <ul className="issue-timeline">
        {entries.map((entry) => (
          <li key={entry.id} className={`timeline-entry ${entry.kind}`}>
            <div className="timeline-head">
              <span className="timeline-author">{entry.author}</span>
              {entry.kind === "comment" && entry.internal && (
                <span
                  className="timeline-tag internal"
                  title="Only people working the issue can read this"
                >
                  internal
                </span>
              )}
              <span className="timeline-when" title={entry.createdAt}>
                {entry.createdAt
                  ? timeAgo(entry.createdAt)
                  : "at an unknown time"}
              </span>
            </div>
            <TimelineBody entry={entry} />
          </li>
        ))}
      </ul>
    </>
  );
}

function TimelineBody({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "comment":
      return <p className="timeline-text">{entry.text}</p>;
    case "status":
      return <p className="timeline-status">{statusChangeLabel(entry)}</p>;
    case "worklog":
      return (
        <p className="timeline-worklog">
          <span className="timeline-duration">
            {formatDuration(entry.timeSpentSeconds)}
          </span>
          {entry.comment && <span> · {entry.comment}</span>}
        </p>
      );
  }
}
