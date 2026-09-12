import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, IssueSummary, MissingWorklog, WorklogEntry } from "../api";
import { formatDuration, weekRange } from "../time";
import { usePinnedIssues } from "../pins";
import { useRowSelected, useSelectionScope } from "../selection";
import { useMissing } from "../missing";
import { removeTemplate, useTemplates, WorklogTemplate } from "../templates";
import IssueRow from "./IssueRow";
import WeekChart from "./WeekChart";
import RepeatModal from "./RepeatModal";
import MissingRow, { missingRowKey } from "./MissingRow";

interface Props {
  site: string;
  refreshKey: number;
  /** Jump to the log-work tab with this issue preselected. */
  onSelectIssue: (issue: IssueSummary) => void;
  /** Jump to the missing-worklog tab. */
  onOpenMissing: () => void;
  /** A worklog was created (template chip) — refresh dependent views. */
  onLogged: () => void;
}

// Start tab: due issues, this week's progress, worklog templates, and
// unlogged activity at a glance.
export default function Start({
  site,
  refreshKey,
  onSelectIssue,
  onOpenMissing,
  onLogged,
}: Props) {
  const missing = useMissing();
  const templates = useTemplates();

  return (
    <div className="panel start">
      <DueSection site={site} onSelectIssue={onSelectIssue} />
      <WeekSection refreshKey={refreshKey} />
      {templates.length > 0 && (
        <TemplatesSection templates={templates} onLogged={onLogged} />
      )}
      {missing.length > 0 && (
        <MissingSection
          site={site}
          items={missing}
          onOpenMissing={onOpenMissing}
        />
      )}
    </div>
  );
}

/** Issues assigned to me due within the last 7 or next 14 days. */
/** This screen's two lists, in the order the arrows walk them. The template
 *  chips are deliberately not a third: a horizontal row of chips is not a list,
 *  and ↑/↓ over it would be the wrong gesture. */
const DUE_SCOPE = "start.due";
const MISSING_SCOPE = "start.missing";

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

  // The first of this screen's two lists: the arrows walk the due issues, then
  // cross into the missing worklogs below them. Explicit order rather than
  // registration order, because the two sections mount independently.
  useSelectionScope({
    id: DUE_SCOPE,
    order: 0,
    rows: (issues ?? []).map((i) => i.key),
    open: (key) => {
      const issue = (issues ?? []).find((i) => i.key === key);
      if (issue) onSelectIssue(issue);
    },
  });

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
          <DueRow
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

/** One due issue, told whether the keyboard is on it. A wrapper so the
 *  subscription is the row's own — see the same shape in Todo. */
function DueRow(props: Parameters<typeof IssueRow>[0]) {
  const selected = useRowSelected(DUE_SCOPE, props.issue.key);
  return <IssueRow {...props} selected={selected} />;
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

/** Saved templates as one-click chips; omitted while none are saved. */
function TemplatesSection({
  templates,
  onLogged,
}: {
  templates: WorklogTemplate[];
  onLogged: () => void;
}) {
  const [logging, setLogging] = useState<WorklogTemplate | null>(null);

  return (
    <section className="start-section">
      <div className="day-head">
        <span>Templates</span>
      </div>
      <div className="template-list">
        {templates.map((t) => (
          <div key={t.id} className="template-chip">
            <button
              className="template-use"
              title={`Log ${t.duration} on ${t.issueKey}`}
              onClick={() => setLogging(t)}
            >
              <span className="key">{t.issueKey}</span>
              <span className="duration">{t.duration}</span>
              {t.comment && <span className="comment">{t.comment}</span>}
            </button>
            <button
              className="icon"
              title="Remove template"
              onClick={() => removeTemplate(t.id)}
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {logging && (
        <RepeatModal
          issueKey={logging.issueKey}
          issueSummary={logging.issueSummary}
          initial={{
            duration: logging.duration,
            comment: logging.comment,
            nonBillable: logging.nonBillable,
          }}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            onLogged();
          }}
        />
      )}
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
  // The second list, after the due issues. A reminder has no "open" of its own
  // here — the row's action is to go to the tab that owns it, which is what
  // Enter does.
  useSelectionScope({
    id: MISSING_SCOPE,
    order: 1,
    rows: items.map(missingRowKey),
    open: onOpenMissing,
  });

  return (
    <section className="start-section">
      <div className="day-head">
        <span>Missing worklogs</span>
        <button className="link" onClick={onOpenMissing}>
          Open tab
        </button>
      </div>
      {items.map((item) => (
        <StartMissingRow
          key={missingRowKey(item)}
          item={item}
          site={site}
          actionTitle="Show in the missing-worklog tab"
          onAction={onOpenMissing}
        />
      ))}
    </section>
  );
}

/** One reminder on this screen, told whether the keyboard is on it. */
function StartMissingRow(props: Parameters<typeof MissingRow>[0]) {
  const selected = useRowSelected(MISSING_SCOPE, missingRowKey(props.item));
  return <MissingRow {...props} selected={selected} />;
}
