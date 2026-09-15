import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, MissingWorklog } from "../api";
import { clearForward, useBackTarget } from "../back";
import { useShortcut, useShortcutBadge } from "../shortcuts";
import { useRowSelected, useSelectionScope } from "../selection";
import { timeAgo, toDateInput, toTimeInput } from "../time";
import {
  ignoreMissing,
  markMissingSeen,
  refreshMissing,
  restoreIgnoredMissing,
  useMissing,
  useMissingError,
  useMissingHiddenCount,
  useMissingLastChecked,
} from "../missing";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";
import IssueHistory from "./IssueHistory";
import { IssueKeyLink, IssueKeyText } from "./IssueKeyLink";
import MissingRow, { missingRowKey } from "./MissingRow";
import { recordEvent } from "../achievements";
import AchievementToast from "./AchievementToast";

interface Props {
  site: string;
}

/** This list's name in the selection registry. */
const SCOPE = "missing";

/** One reminder, told whether the keyboard is on it. */
function TabMissingRow(props: Parameters<typeof MissingRow>[0]) {
  const selected = useRowSelected(SCOPE, missingRowKey(props.item));
  return <MissingRow {...props} selected={selected} />;
}

// Reminder list: issues with recent own activity but no worklog around it.
// Clicking an item opens an inline log form; saving returns to the refreshed
// list (the filed worklog triggers the recheck — see `useAccountWatchers`). DEV
// issues log their time on the linked escalation-source issue, when that issue
// is the user's own.
export default function MissingWorklogs({ site }: Props) {
  const items = useMissing();
  const hidden = useMissingHiddenCount();
  const error = useMissingError();
  const lastChecked = useMissingLastChecked();
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState<MissingWorklog | null>(null);
  const [awards, setAwards] = useState<string[]>([]);

  // Viewing the tab acknowledges the current findings (stops the blinking).
  useEffect(() => {
    markMissingSeen();
  }, [items]);

  // Only after a real check: nothing found before the first scan means "not
  // looked yet", which is not an achievement. Neither is an empty list the user
  // emptied by ignoring everything in it.
  useEffect(() => {
    if (lastChecked && items.length === 0 && hidden === 0)
      setAwards(recordEvent({ kind: "missingEmpty" }));
  }, [items, hidden, lastChecked]);

  async function refresh() {
    setBusy(true);
    await refreshMissing("manual");
    setBusy(false);
  }

  // Not while the log form is up: the screen's refresh is behind it, and the key
  // belongs to whatever is in front.
  const refreshKeys = useShortcut(
    "refresh",
    refresh,
    !busy && logging === null,
  );

  const startLogging = useCallback((item: MissingWorklog) => {
    clearForward();
    setLogging(item);
  }, []);

  // Not while the log form is up: the arrows belong to the form, not to the list
  // behind it.
  useSelectionScope(
    {
      id: SCOPE,
      rows: items.map(missingRowKey),
      // Enter opens the form for that finding, which is what its row does.
      open: (key) => {
        const item = items.find((i) => missingRowKey(i) === key);
        if (item) startLogging(item);
      },
    },
    logging === null,
  );

  const closeForm = useCallback(() => setLogging(null), []);
  const reopenForm = useCallback(() => {
    if (logging) setLogging(logging);
  }, [logging]);
  useBackTarget(
    { label: "the list", back: closeForm, forward: reopenForm },
    logging !== null,
  );

  if (logging) {
    return (
      <LogForm
        item={logging}
        site={site}
        onCancel={closeForm}
        onSaved={closeForm}
      />
    );
  }

  return (
    <div className="panel">
      <AchievementToast queue={awards} />
      <div className="missing-head">
        <span className="hint">
          Issues you commented on or moved in the last 24 hours without logging
          time around it. Rechecked every 15 minutes; activity from the last 10
          minutes isn't flagged yet.
        </span>
        <div className="missing-actions">
          <button
            className="link"
            {...refreshKeys}
            onClick={refresh}
            disabled={busy}
          >
            {busy ? "Checking…" : "Check now"}
          </button>
          {lastChecked && (
            <span className="missing-meta">at {lastChecked}</span>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !lastChecked && <p className="muted empty">Checking…</p>}
      {!error && lastChecked && items.length === 0 && hidden === 0 && (
        <p className="muted empty">Nothing unlogged. All caught up.</p>
      )}

      {items.map((item) => (
        <TabMissingRow
          key={missingRowKey(item)}
          item={item}
          site={site}
          actionTitle={`Log work on ${item.logKey}`}
          onAction={() => startLogging(item)}
          showLogTarget
          onIgnore={() => ignoreMissing(item)}
        />
      ))}

      {hidden > 0 && (
        <p className="hint missing-hidden">
          {hidden} ignored ·{" "}
          <button className="link" onClick={restoreIgnoredMissing}>
            Show again
          </button>
        </p>
      )}
    </div>
  );
}

function LogForm({
  item,
  site,
  onCancel,
  onSaved,
}: {
  item: MissingWorklog;
  site: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Default the start to the flagged activity, so the new worklog covers it
  // and the reminder clears.
  const activity = new Date(item.activityAt);
  const { draft, patch, seconds } = useWorklogDraft({
    date: toDateInput(activity),
    time: toTimeInput(activity),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(item.logKey, toWorklogInput(draft, seconds));
      onSaved();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  // `back.ts` answers the chord for the way out the tab registered; this says
  // where its badge belongs.
  const backBadge = useShortcutBadge("back");

  return (
    <div className="panel">
      <button className="link" {...backBadge} onClick={onCancel}>
        <ArrowLeft size={15} strokeWidth={2} aria-hidden />
        Back to the list
      </button>
      <div className="issue-chip">
        <IssueKeyLink issueKey={item.logKey} site={site} />
        <span className="summary">{item.logSummary}</span>
      </div>
      {item.logKey !== item.issueKey && (
        <p className="hint missing-source">
          Escalation source of{" "}
          <IssueKeyLink issueKey={item.issueKey} site={site} /> — the time is
          logged here.
        </p>
      )}
      {/* The comment is the whole of the reminder's context, and it is often a
          sentence about some other issue. The keys in it are links, so reading
          further is a click rather than a retyped key. */}
      {item.detail && (
        <p className="hint missing-reason">
          {item.kind === "comment" ? "Your comment" : "Status change"}{" "}
          {timeAgo(item.activityAt)}: {item.kind === "comment" && "“"}
          <IssueKeyText text={item.detail} site={site} />
          {item.kind === "comment" && "”"}
        </p>
      )}

      <WorklogFields draft={draft} patch={patch} seconds={seconds} />

      {error && <p className="error">{error}</p>}

      <button onClick={save} disabled={busy}>
        {busy ? "Logging…" : "Log work"}
      </button>

      <IssueHistory issueKey={item.logKey} />
    </div>
  );
}
