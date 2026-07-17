import { useState } from "react";
import { api } from "../api";
import { formatDuration, toDateInput, toTimeInput } from "../time";
import {
  ActiveTimer,
  formatClock,
  roundUpToQuarterHour,
  stopTimer,
  useElapsedSeconds,
  useTimer,
} from "../timer";
import {
  DURATION_ERROR,
  useWorklogDraft,
  WorklogFields,
} from "./WorklogFields";

interface Props {
  onLogged: () => void;
}

interface StopData {
  timer: ActiveTimer;
  seconds: number; // rounded-up elapsed
}

export default function TimerBar({ onLogged }: Props) {
  const timer = useTimer();
  const elapsed = useElapsedSeconds(timer);
  const [stopping, setStopping] = useState<StopData | null>(null);

  function onStop() {
    if (!timer) return;
    setStopping({ timer, seconds: roundUpToQuarterHour(elapsed) });
    stopTimer(); // freeze the clock; the captured data lives in `stopping`
  }

  if (!timer && !stopping) return null;

  return (
    <>
      {timer && (
        <div className="timer-bar">
          <span className="timer-dot" aria-hidden="true" />
          <div className="timer-info">
            <span className="key">{timer.issueKey}</span>
            <span className="summary">{timer.issueSummary}</span>
          </div>
          <span className="timer-clock">{formatClock(elapsed)}</span>
          <button className="timer-stop" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      {stopping && (
        <StopModal
          data={stopping}
          onClose={() => setStopping(null)}
          onLogged={() => {
            setStopping(null);
            onLogged();
          }}
        />
      )}
    </>
  );
}

function StopModal({
  data,
  onClose,
  onLogged,
}: {
  data: StopData;
  onClose: () => void;
  onLogged: () => void;
}) {
  const started = new Date(data.timer.startedAt);
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
      await api.logWork(
        data.timer.issueKey,
        seconds,
        draft.date,
        draft.time,
        draft.comment,
        !draft.nonBillable,
      );
      onLogged();
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

        <div className="row">
          {confirmDiscard ? (
            <>
              <span className="confirm-text">Discard tracked time?</span>
              <button className="secondary" onClick={() => setConfirmDiscard(false)}>
                Keep
              </button>
              <button className="danger" onClick={onClose}>
                Discard
              </button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => setConfirmDiscard(true)}>
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
