import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { useShortcut } from "../shortcuts";
import { formatDuration, toDateInput, toTimeInput } from "../time";
import {
  ActiveTimer,
  elapsedSeconds,
  formatClock,
  getTimer,
  isPaused,
  isPlayfulClock,
  pauseTimer,
  resumeTimer,
  roundUpToQuarterHour,
  stopTimer,
  timerStartedAt,
  useElapsedSeconds,
  useTimer,
} from "../timer";
import IssueHistory from "./IssueHistory";
import {
  DURATION_ERROR,
  toWorklogInput,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface StopData {
  timer: ActiveTimer;
  seconds: number; // rounded-up elapsed
}

export default function TimerBar() {
  const timer = useTimer();
  const elapsed = useElapsedSeconds(timer);
  const [stopping, setStopping] = useState<StopData | null>(null);

  function onStop() {
    if (!timer) return;
    setStopping({ timer, seconds: roundUpToQuarterHour(elapsed) });
    stopTimer(); // freeze the clock; the captured data lives in `stopping`
  }

  const paused = !!timer && isPaused(timer);

  function onPauseToggle() {
    if (paused) resumeTimer();
    else pauseTimer();
  }

  // "Stop timer" in the system tray routes through the same log-modal flow;
  // its pause item flips the timer the same way the bar's button does. Both
  // read the live store, not a stale closure.
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    let gone = false;
    const subscriptions = [
      listen("stop-timer", () => {
        const t = getTimer();
        if (!t) return;
        const secs = elapsedSeconds(t, Date.now());
        setStopping({ timer: t, seconds: roundUpToQuarterHour(secs) });
        stopTimer();
      }),
      listen("toggle-pause-timer", () => {
        const t = getTimer();
        if (!t) return;
        if (isPaused(t)) resumeTimer();
        else pauseTimer();
      }),
    ];
    for (const sub of subscriptions) {
      sub.then((fn) => {
        // Unmounted before the subscription landed: drop it straight away.
        if (gone) fn();
        else unlistens.push(fn);
      });
    }
    return () => {
      gone = true;
      for (const fn of unlistens) fn();
    };
  }, []);

  // Bound only while a timer is actually running, which is also the only time
  // the bar is on screen. Starting one is per issue row — a different shortcut
  // on a different thing, and step 6's business.
  const live = !!timer && !stopping;
  const stopKeys = useShortcut("timer", onStop, live);
  const pauseKeys = useShortcut("pauseTimer", onPauseToggle, live);

  if (!timer && !stopping) return null;

  return (
    <>
      {timer && (
        <div className={`timer-bar${paused ? " paused" : ""}`}>
          <span className="timer-dot" aria-hidden="true" />
          <div className="timer-info">
            <span className="key">{timer.issueKey}</span>
            <span className="summary">{timer.issueSummary}</span>
          </div>
          <span
            className={`timer-clock${isPlayfulClock(elapsed) ? " wink" : ""}`}
          >
            {formatClock(elapsed)}
          </span>
          <button
            className="secondary timer-pause"
            {...pauseKeys}
            onClick={onPauseToggle}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="timer-stop" {...stopKeys} onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      {stopping && (
        <StopModal data={stopping} onClose={() => setStopping(null)} />
      )}
    </>
  );
}

/** `onClose` runs after a worklog is filed as well as on a discard: either way
 *  the tracked time has been dealt with. */
function StopModal({ data, onClose }: { data: StopData; onClose: () => void }) {
  // When the work began, however often it was paused since.
  const started = new Date(timerStartedAt(data.timer));
  const { draft, patch, seconds } = useWorklogDraft({
    duration: formatDuration(data.seconds),
    date: toDateInput(started),
    time: toTimeInput(started),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function save() {
    if (seconds === null) {
      setError(DURATION_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(data.timer.issueKey, toWorklogInput(draft, seconds));
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // No backdrop-click close here — tracked time shouldn't be lost by accident.
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Log time — {data.timer.issueKey}</h3>
        <p className="muted modal-sub">{data.timer.issueSummary}</p>

        <WorklogFields
          draft={draft}
          patch={patch}
          seconds={seconds}
          durationLabel="Time spent (rounded up to 15 min)"
        />

        {error && <p className="error">{error}</p>}

        <IssueHistory issueKey={data.timer.issueKey} />

        <div className="row">
          {confirmDiscard ? (
            <>
              <span className="confirm-text">Discard tracked time?</span>
              <button
                className="secondary"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep
              </button>
              <button className="danger" onClick={onClose}>
                Discard
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary"
                onClick={() => setConfirmDiscard(true)}
              >
                Discard
              </button>
              <button onClick={save} disabled={busy}>
                {busy ? "Logging…" : "Log work"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
