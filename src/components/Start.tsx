import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, IssueSummary, MissingWorklog, WorklogEntry } from "../api";
import { formatDuration, timeAgo, weekRange } from "../time";
import { usePinnedIssues } from "../pins";
import { useMissing } from "../missing";
import IssueRow from "./IssueRow";
import WeekChart from "./WeekChart";

interface Props {
  site: string;
  refreshKey: number;
  /** Jump to the log-work tab with this issue preselected. */
  onSelectIssue: (issue: IssueSummary) => void;
  /** Jump to the missing-worklog tab. */
  onOpenMissing: () => void;
}

// Start tab: due issues, this week's progress, and unlogged activity at a glance.
export default function Start({
  site,
  refreshKey,
  onSelectIssue,
  onOpenMissing,
}: Props) {
  const missing = useMissing();

  return (
    <div className="panel start">
      <DueSection site={site} onSelectIssue={onSelectIssue} />
      <WeekSection refreshKey={refreshKey} />
      {missing.length > 0 && (
        <MissingSection site={site} items={missing} onOpenMissing={onOpenMissing} />
      )}
    </div>
  );
}

/** Issues assigned to me due within the last 7 or next 14 days. */
function DueSection({
  site,
  onSelectIssue,
}: {
  site: string;
  onSelectIssue: (issue: IssueSummary) => void;
}) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinnedKeys = new Set(usePinnedIssues().map((p) => p.key));

  useEffect(() => {
    let cancelled = false;
    api.dueIssues().then(
      (list) => {
        if (!cancelled) setIssues(list);
      },
      (err) => {
        if (!cancelled) {
          setIssues([]);
          setError(String(err));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="start-section">
      <div className="day-head">
        <span>Due dates</span>
        <span className="muted">last 7 · next 14 days</span>
      </div>
      {issues === null && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {issues?.length === 0 && !error && (
        <p className="muted empty">Nothing due soon.</p>
      )}
      <ul className="issue-list">
        {issues?.map((issue) => (
          <IssueRow
            key={issue.key}
            issue={issue}
            site={site}
            pinned={pinnedKeys.has(issue.key)}
            onSelect={onSelectIssue}
          />
        ))}
      </ul>
    </section>
  );
}

/** This week's charts, same data as the timesheet's current week. */
function WeekSection({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { start, end } = weekRange(0);

  useEffect(() => {
    let cancelled = false;
    api.listWorklogs(start, end).then(
      (list) => {
        if (!cancelled) setEntries(list);
      },
      (err) => {
        if (!cancelled) setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [start, end, refreshKey]);

  const total = entries.reduce((s, e) => s + e.timeSpentSeconds, 0);

  return (
    <section className="start-section">
      <div className="day-head">
        <span>This week</span>
        <span className="muted">{formatDuration(total)} logged</span>
      </div>
      {error && <p className="error">{error}</p>}
      <WeekChart start={start} entries={entries} />
    </section>
  );
}

/** Unlogged activity; the whole section is omitted when there is none. */
function MissingSection({
  site,
  items,
  onOpenMissing,
}: {
  site: string;
  items: MissingWorklog[];
  onOpenMissing: () => void;
}) {
  return (
    <section className="start-section">
      <div className="day-head">
        <span>Missing worklogs</span>
        <button className="link" onClick={onOpenMissing}>
          Open tab
        </button>
      </div>
      {items.map((item) => (
        <div key={`${item.issueKey}-${item.activityAt}`} className="worklog-row">
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
              title="Show in the missing-worklog tab"
              onClick={onOpenMissing}
            >
              <span className="summary">{item.issueSummary}</span>
              {item.detail && (
                <span className="comment">
                  {item.kind === "comment" ? `“${item.detail}”` : item.detail}
                </span>
              )}
            </button>
          </div>
          <span className="missing-meta">
            {item.kind === "comment" ? "commented" : "status changed"}{" "}
            {timeAgo(item.activityAt)}
          </span>
        </div>
      ))}
    </section>
  );
}
