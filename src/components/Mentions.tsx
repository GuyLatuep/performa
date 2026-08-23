import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IssueSummary, Mention } from "../api";
import IssueView from "./IssueView";
import { timeAgo } from "../time";
import {
  markMentionsRead,
  mentionId,
  refreshMentions,
  unreadMentionIds,
  useMentions,
  useMentionsError,
  useMentionsLastChecked,
  useMentionsNameSearchSkipped,
  useMentionsTruncated,
} from "../mentions";

interface Props {
  site: string;
  /** A worklog was filed from an opened issue — refresh what depends on it. */
  onLogged: () => void;
}

// Inbox of comments that tag the user. Opening the tab marks everything listed
// as read; the rows stay highlighted for this visit so it is still visible
// what was new when the tab was opened.
export default function Mentions({ site, onLogged }: Props) {
  // A Mention means somebody wants something from you, and the expected
  // response is to go and look at the issue — so a row opens it.
  const [opened, setOpened] = useState<IssueSummary | null>(null);
  const items = useMentions();
  const error = useMentionsError();
  const lastChecked = useMentionsLastChecked();
  const truncated = useMentionsTruncated();
  const nameSearchSkipped = useMentionsNameSearchSkipped();
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

  if (opened) {
    return (
      <IssueView
        issue={opened}
        site={site}
        backLabel="Mentions"
        onBack={() => {
          setOpened(null);
          void refreshMentions("manual");
        }}
        onLogged={onLogged}
      />
    );
  }

  return (
    <div className="panel">
      <div className="missing-head">
        <span className="hint">
          Comments from the last 14 days in which somebody @-mentioned you.
          Rechecked every 3 minutes.
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
      {/* Above the list — and above the empty state especially: "nothing
          found" must not read as "nothing exists" when the scan knows it did
          not look everywhere. */}
      {!error && nameSearchSkipped && (
        <p className="mention-partial">
          Your Jira account has no display name, so the search of comment text
          cannot run. Only issues you are otherwise involved with are looked at
          — a mention on any other issue is not listed here.
        </p>
      )}
      {!error && truncated && (
        <p className="mention-partial">
          Jira offers no “my mentions” search, so this looks through a limited
          number of recently updated issues. This time there were more than it
          could open — a mention on one of the issues it skipped is not listed
          here.
        </p>
      )}
      {!error && lastChecked && items.length === 0 && (
        <p className="muted empty">No mentions found in the last 14 days.</p>
      )}

      {items.map((item) => (
        <MentionRow
          key={mentionId(item)}
          item={item}
          site={site}
          unread={unread.has(mentionId(item))}
          onOpen={setOpened}
        />
      ))}
    </div>
  );
}

function MentionRow({
  item,
  site,
  unread,
  onOpen,
}: {
  item: Mention;
  site: string;
  unread: boolean;
  onOpen: (issue: IssueSummary) => void;
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
          className="mention-head"
          title={`Open ${item.issueKey} in browser`}
          onClick={() => openUrl(`${site}/browse/${item.issueKey}`)}
        >
          <span className="key">{item.issueKey}</span>
          <span className="summary">{item.issueSummary}</span>
        </button>
        <button
          className="mention-body"
          title="Open the comment in browser"
          onClick={() => openUrl(commentUrl)}
        >
          {item.author}: {item.text ? `“${item.text}”` : "mentioned you"}
        </button>
      </div>
      <div className="mention-side">
        <span className="missing-meta">
          {unread && <span className="unread-dot" title="Unread" />}
          {timeAgo(item.createdAt)}
        </span>
        {/* A deliberate exception to the line between the two inboxes: a
            Mention is something to go and look at, and logging forgotten time
            is the missing-worklog tab's job. It is here by user request,
            because being pinged is often the moment work starts — hence the
            shortcut, demoted so the row still reads as "go look at this". */}
        <button
          className="link mention-log"
          title={`Open ${item.issueKey}`}
          onClick={() =>
            onOpen({ key: item.issueKey, summary: item.issueSummary })
          }
        >
          Open issue
        </button>
      </div>
    </div>
  );
}
