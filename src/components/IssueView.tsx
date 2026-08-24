import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  api,
  IssueActivity,
  IssueDetail,
  IssueSummary,
  LinkedItem,
  Transition,
} from "../api";
import { OfferedTransition } from "../transitions";
import { useIssueFieldConfig } from "../issueFieldNames";
import { logInfo } from "../log";
import { recordEvent } from "../achievements";
import IssueActions from "./IssueActions";
import IssueAttachments from "./IssueAttachments";
import IssueDescription from "./IssueDescription";
import IssueFacts from "./IssueFacts";
import IssueLinks from "./IssueLinks";
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
  /** Issues opened from a link, deepest last — `issue` is the one the list
   *  opened and stays at the bottom of it.
   *
   *  A trail rather than a swap, because following a link is a detour: you go
   *  and look at what blocks this issue and then you come back to it. Replacing
   *  the open issue would leave "Back to Todo" as the only way out, and taking
   *  it would lose the issue that was actually being worked on. */
  const [trail, setTrail] = useState<IssueSummary[]>([]);
  const open = trail[trail.length - 1] ?? issue;
  /** Where Back goes: the issue this one was opened from, or the list. */
  const cameFrom = trail.length > 0 ? (trail[trail.length - 2] ?? issue) : null;

  // A different issue opened from the list is a fresh start, not a step deeper.
  useEffect(() => setTrail([]), [issue.key]);

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
  const fieldNames = fieldConfig.detail.join("|");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    logInfo(`opened issue view for ${open.key}`);
    // Two requests rather than one: the detail is cached and the timeline
    // deliberately is not, so joining them would drag the whole view back to
    // Jira on every reload.
    api
      .issueDetail(open.key, fieldNames === "" ? [] : fieldNames.split("|"))
      .then(
        (d) => !cancelled && setDetail(d),
        (err) => !cancelled && setError(String(err)),
      );
    api.issueActivity(open.key).then(
      (a) => !cancelled && setActivity(a),
      (err) => !cancelled && setError(String(err)),
    );
    setWorkflowError(null);
    api.issueTransitions(open.key).then(
      (t) => !cancelled && setTransitions(t),
      (err) => !cancelled && setWorkflowError(String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [open.key, reloadKey, fieldNames]);

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
        await api.transitionIssue(open.key, entry.id, fields);
        logInfo(`moved ${open.key} via ${entry.name}`);
        recordEvent({ kind: "transitioned" });
        setScreen(null);
        reload();
      } catch (err) {
        // Unlike the timer's status nudge, this one was asked for — say so.
        setMoveError(String(err));
      } finally {
        setMoving(false);
      }
    },
    [open.key, reload],
  );

  /** Follow a link: the other issue is read in this same view, one step
   *  deeper. Ignored when it is already the open one — a link cannot point at
   *  its own issue, but a stale detail could still be showing one. */
  const openLinked = useCallback(
    (item: LinkedItem) =>
      setTrail((t) =>
        (t[t.length - 1] ?? issue).key === item.key
          ? t
          : [...t, { key: item.key, summary: item.summary }],
      ),
    [issue],
  );

  // A move changes the status, so the picker must not keep showing a screen
  // opened from the status the issue has just left.
  useEffect(() => setScreen(null), [open.key]);

  return (
    <div className="panel issue-view">
      <div className="back-row">
        <button
          className="link"
          onClick={() =>
            cameFrom ? setTrail((t) => t.slice(0, -1)) : onBack()
          }
        >
          ← Back to {cameFrom ? cameFrom.key : backLabel}
        </button>
        <button
          className="link"
          title={`Open ${open.key} in browser`}
          onClick={() => openUrl(`${site}/browse/${open.key}`)}
        >
          Open in Jira ↗
        </button>
      </div>

      <div className="issue-head">
        <div className="issue-chip">
          <span className="key">{open.key}</span>
          <span className="summary">{detail?.summary ?? open.summary}</span>
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
            issueKey={open.key}
            site={site}
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
              issueKey={open.key}
              attachments={detail.attachments}
              onAttached={reload}
            />
          </section>

          <section className="issue-section">
            <h3>
              Linked work items
              {detail.links.length > 0 && ` · ${detail.links.length}`}
            </h3>
            <IssueLinks
              issueKey={open.key}
              site={site}
              links={detail.links}
              onChanged={reload}
              onOpen={openLinked}
            />
          </section>

          <section className="issue-section">
            <IssueActions
              issueKey={open.key}
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
