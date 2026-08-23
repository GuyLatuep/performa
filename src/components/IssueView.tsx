import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  api,
  IssueActivity,
  IssueDetail,
  IssueSummary,
  Transition,
} from "../api";
import { OfferedTransition } from "../transitions";
import { requestedFieldNames, useIssueFieldConfig } from "../issueFieldNames";
import { logInfo } from "../log";
import IssueActions from "./IssueActions";
import IssueAttachments from "./IssueAttachments";
import IssueDescription from "./IssueDescription";
import IssueFacts from "./IssueFacts";
import IssueStatusPicker from "./IssueStatusPicker";
import IssueTimeline, { timelineCount } from "./IssueTimeline";
import TransitionScreen from "./TransitionScreen";

interface Props {
  issue: IssueSummary;
  site: string;
  /** Back to the list this issue was opened from. */
  onBack: () => void;
  backLabel: string;
  /** A worklog was filed here — refresh what depends on it. */
  onLogged: () => void;
}

// The issue view: one issue read in full, with its timeline, a comment box and
// a log-work panel. Workflow moves land on top of this.
export default function IssueView({
  issue,
  site,
  onBack,
  backLabel,
  onLogged,
}: Props) {
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [activity, setActivity] = useState<IssueActivity | null>(null);
  const [transitions, setTransitions] = useState<Transition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The workflow is the one part that may be unreadable on its own (a project
  // permission can hide it), and losing it should cost the transition buttons,
  // not the whole view.
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  // Bumped after any write here, so all three reads pick the change up.
  const [reloadKey, setReloadKey] = useState(0);
  const fieldConfig = useIssueFieldConfig();
  // A stable key: the request depends on the configured names, so changing
  // them in settings has to re-run the effect.
  const fieldNames = requestedFieldNames(fieldConfig).join("|");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    logInfo(`opened issue view for ${issue.key}`);
    // Two requests rather than one: the detail is cached and the timeline
    // deliberately is not, so joining them would drag the whole view back to
    // Jira on every reload.
    api
      .issueDetail(issue.key, fieldNames === "" ? [] : fieldNames.split("|"))
      .then(
        (d) => !cancelled && setDetail(d),
        (err) => !cancelled && setError(String(err)),
      );
    api.issueActivity(issue.key).then(
      (a) => !cancelled && setActivity(a),
      (err) => !cancelled && setError(String(err)),
    );
    setWorkflowError(null);
    api.issueTransitions(issue.key).then(
      (t) => !cancelled && setTransitions(t),
      (err) => !cancelled && setWorkflowError(String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [issue.key, reloadKey, fieldNames]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // The picker sits in the header and the screen renders below the facts, so
  // the state they share belongs to neither of them.
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [screen, setScreen] = useState<OfferedTransition | null>(null);

  const runMove = useCallback(
    async (entry: OfferedTransition, fields?: Record<string, unknown>) => {
      setMoving(true);
      setMoveError(null);
      try {
        await api.transitionIssue(issue.key, entry.id, fields);
        logInfo(`moved ${issue.key} via ${entry.name}`);
        setScreen(null);
        reload();
      } catch (err) {
        // Unlike the timer's status nudge, this one was asked for — say so.
        setMoveError(String(err));
      } finally {
        setMoving(false);
      }
    },
    [issue.key, reload],
  );

  // A move changes the status, so the picker must not keep showing a screen
  // opened from the status the issue has just left.
  useEffect(() => setScreen(null), [issue.key]);

  return (
    <div className="panel issue-view">
      <div className="back-row">
        <button className="link" onClick={onBack}>
          ← Back to {backLabel}
        </button>
        <button
          className="link"
          title={`Open ${issue.key} in browser`}
          onClick={() => openUrl(`${site}/browse/${issue.key}`)}
        >
          Open in Jira ↗
        </button>
      </div>

      <div className="issue-head">
        <div className="issue-chip">
          <span className="key">{issue.key}</span>
          <span className="summary">{detail?.summary ?? issue.summary}</span>
        </div>
        <IssueStatusPicker
          current={detail?.status}
          transitions={transitions}
          error={workflowError}
          busy={moving}
          onPick={(entry) =>
            entry.mode === "screen" ? setScreen(entry) : runMove(entry)
          }
        />
      </div>
      {moveError && <p className="error">{moveError}</p>}

      {error && <p className="error">{error}</p>}
      {!detail && !error && <p className="muted">Loading…</p>}

      {detail && (
        <>
          <IssueFacts
            detail={detail}
            teamField={fieldConfig.team}
            issueKey={issue.key}
            onChanged={reload}
          />

          {screen && (
            <section className="issue-section">
              <h3>{screen.name}</h3>
              <TransitionScreen
                // Per transition: the screen holds its own draft and its own
                // "required" errors, and picking a second move without
                // cancelling the first would otherwise reuse both — including a
                // value for a field id the two screens happen to share.
                key={screen.id}
                entry={screen}
                busy={moving}
                failure={moveError}
                onCancel={() => {
                  setScreen(null);
                  setMoveError(null);
                }}
                onSubmit={(fields) => runMove(screen, fields)}
              />
            </section>
          )}

          {detail.description ? (
            <section className="issue-section">
              <h3>Description</h3>
              <IssueDescription text={detail.description} />
            </section>
          ) : (
            <p className="muted empty">No description.</p>
          )}

          <section className="issue-section">
            <h3>
              Attachments
              {detail.attachments.length > 0 &&
                ` · ${detail.attachments.length}`}
            </h3>
            <IssueAttachments
              issueKey={issue.key}
              attachments={detail.attachments}
              onAttached={reload}
            />
          </section>

          <section className="issue-section">
            <IssueActions
              issueKey={issue.key}
              serviceDesk={detail.serviceDesk}
              onPosted={reload}
              onLogged={() => {
                onLogged();
                reload();
              }}
            />
          </section>
        </>
      )}

      <section className="issue-section">
        <h3>
          Timeline
          {activity && ` · ${timelineCount(activity)}`}
        </h3>
        {!activity && !error && <p className="muted">Loading…</p>}
        {activity && <IssueTimeline activity={activity} />}
      </section>
    </div>
  );
}
