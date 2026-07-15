import { useState } from "react";
import { api } from "../api";
import { formatDuration, parseDuration, toDateInput, today } from "../time";
import {
  ActiveTimer,
  formatClock,
  roundUpToQuarterHour,
  stopTimer,
  useElapsedSeconds,
  useTimer,
} from "../timer";

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
  const [duration, setDuration] = useState(formatDuration(data.seconds));
  const [date, setDate] = useState(toDateInput(new Date(data.timer.startedAt)));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seconds = parseDuration(duration);

  async function save() {
    if (seconds === null) {
      setError("Enter a valid duration, e.g. 1h 30m");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(data.timer.issueKey, seconds, date, comment);
      onLogged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (confirm("Discard this tracked time without logging?")) onClose();
  }

  return (
    // No backdrop-click close here — tracked time shouldn't be lost by accident.
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Log time — {data.timer.issueKey}</h3>
        <p className="muted modal-sub">{data.timer.issueSummary}</p>

        <label>
          Time spent (rounded up to 15 min)
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            autoFocus
          />
          {seconds !== null && (
            <span className="hint">= {formatDuration(seconds)}</span>
          )}
        </label>

        <label>
          Date
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label>
          Comment (optional)
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="row">
          <button className="secondary" onClick={discard}>
            Discard
          </button>
          <button onClick={save} disabled={busy}>
            {busy ? "Logging…" : "Log work"}
          </button>
        </div>
      </div>
    </div>
  );
}
