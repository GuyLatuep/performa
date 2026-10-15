import { useEffect } from "react";
import { closeIdlePrompt, isCurrent, useIdlePrompt } from "../idle";
import { formatDuration, toTimeInput } from "../time";
import {
  discardAway,
  getTimer,
  parkAway,
  runningMsWithin,
  stopAtAway,
  useTimer,
} from "../timer";

/**
 * "You were away": what to do with the time the timer counted while nobody
 * was at the machine. Asked once the user is back, never while they are away.
 *
 * Keep is the default — it holds the focus, so Enter answers it — because
 * losing time that was work is worse than having to trim a booking later.
 */
export default function IdlePrompt() {
  const away = useIdlePrompt();
  const timer = useTimer();
  const current = away !== null && isCurrent(away, timer);

  // The timer it asked about was stopped or switched away from while the
  // question stood: the answer would land on a different timer, so there is
  // no question any more.
  useEffect(() => {
    if (away && !current) closeIdlePrompt();
  }, [away, current]);

  if (!away || !timer || !current) return null;

  const counted = runningMsWithin(timer, away.from, away.to);
  const span = `${toTimeInput(new Date(away.from))}–${toTimeInput(new Date(away.to))}`;
  const on = timer.issueKey ?? "the timer without a ticket";

  // Each answer acts on the timer as it is at the moment of the click, which
  // is why they read the store rather than the render's copy — and only if it
  // is still the timer the question was about.
  function answer(act: () => void) {
    if (away && isCurrent(away, getTimer())) act();
    closeIdlePrompt();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="You were away">
        <h3>You were away</h3>
        <p className="modal-sub">
          No input for {formatDuration(Math.round(counted / 1000))} ({span})
          while {on} was timing. Was that work?
        </p>
        <div className="row idle-answers">
          <button
            className="secondary"
            title="Take the time away out of the timer"
            onClick={() => answer(() => discardAway(away.from, away.to))}
          >
            Discard
          </button>
          <button
            className="secondary"
            title="Take it out of the timer and park it as a draft"
            onClick={() => answer(() => parkAway(away.from, away.to))}
          >
            Draft
          </button>
          <button
            className="secondary"
            title="Stop the timer where you left, and log the time before"
            onClick={() => answer(() => stopAtAway(away.from))}
          >
            Discard &amp; stop
          </button>
          <button autoFocus onClick={() => answer(() => {})}>
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}
