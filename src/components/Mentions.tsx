import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Mention } from "../api";
import { timeAgo } from "../time";
import {
  markMentionsRead,
  mentionId,
  refreshMentions,
  unreadMentionIds,
  useMentions,
  useMentionsError,
  useMentionsLastChecked,
} from "../mentions";

interface Props {
  site: string;
}

// Inbox of comments that tag the user. Opening the tab marks everything listed
// as read; the rows stay highlighted for this visit so it is still visible
// what was new when the tab was opened.
export default function Mentions({ site }: Props) {
  const items = useMentions();
  const error = useMentionsError();
  const lastChecked = useMentionsLastChecked();
  const [busy, setBusy] = useState(false);
  // Captured once per visit, before the effect below acknowledges them —
  // reading it live would clear the highlighting in the same render.
  const [unread, setUnread] = useState(unreadMentionIds);

  useEffect(() => {
    // A poll landing while the tab is open brings its own new mentions; they
    // join the highlighted set rather than appearing already read.
    setUnread((current) => {
      const fresh = unreadMentionIds();
      return fresh.size === 0 ? current : new Set([...current, ...fresh]);
    });
    markMentionsRead();
  }, [items]);

  async function refresh() {
    setBusy(true);
    await refreshMentions("manual");
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="missing-head">
        <span className="hint">
          Comments from the last 14 days in which somebody @-mentioned you.
          Rechecked every 15 minutes.
        </span>
        <div className="missing-actions">
          <button className="link" onClick={refresh} disabled={busy}>
            {busy ? "Checking…" : "Check now"}
          </button>
          {lastChecked && (
            <span className="missing-meta">at {lastChecked}</span>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !lastChecked && <p className="muted empty">Checking…</p>}
      {!error && lastChecked && items.length === 0 && (
        <p className="muted empty">Nobody mentioned you. Enjoy the quiet.</p>
      )}

      {items.map((item) => (
        <MentionRow
          key={mentionId(item)}
          item={item}
          site={site}
          unread={unread.has(mentionId(item))}
        />
      ))}
    </div>
  );
}

function MentionRow({
  item,
  site,
  unread,
}: {
  item: Mention;
  site: string;
  unread: boolean;
}) {
  // Jira scrolls to and highlights the comment itself with this parameter,
  // which is the whole point of clicking a mention.
  const commentUrl =
    `${site}/browse/${item.issueKey}` +
    `?focusedCommentId=${item.commentId}#comment-${item.commentId}`;

  return (
    <div className={`worklog-row mention-row${unread ? " unread" : ""}`}>
      <div className="worklog-main">
        <button
          className="key-link key"
          title={`Open ${item.issueKey} in browser`}
          onClick={() => openUrl(`${site}/browse/${item.issueKey}`)}
        >
          {item.issueKey}
        </button>
        <button
          className="issue-select"
          title="Open the comment in browser"
          onClick={() => openUrl(commentUrl)}
        >
          <span className="summary">{item.issueSummary}</span>
          <span className="comment">
            {item.author}: {item.text ? `“${item.text}”` : "mentioned you"}
          </span>
        </button>
      </div>
      <span className="missing-meta">
        {unread && <span className="unread-dot" title="Unread" />}
        {timeAgo(item.createdAt)}
      </span>
    </div>
  );
}
