import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatClock, getTimer, useElapsedSeconds, useTimer } from "../timer";
import { getMissing, refreshMissing, useMissing } from "../missing";

type Prompt = "timer" | "checking" | "missing" | null;

// Intercepts the window close: if a timer is still running or unlogged-work
// reminders are pending, block the close and warn in-app (native confirm()
// dialogs are no-ops in Tauri's webview).
export default function CloseGuard() {
  const [prompting, setPrompting] = useState<Prompt>(null);
  const timer = useTimer();
  const missing = useMissing();
  const elapsed = useElapsedSeconds(prompting === "timer" ? timer : null);
  // A second close request while the check runs must not start another scan.
  const checking = useRef(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested(async (event) => {
        // Read the live stores (not stale closures) to decide.
        if (getTimer()) {
          event.preventDefault();
          setPrompting("timer");
          return;
        }
        if (checking.current) {
          event.preventDefault();
          return;
        }
        // The reminder list is only as fresh as the last poll, which is now a
        // quarter of an hour apart — re-check before letting the app go, or
        // work logged just before quitting slips past this guard entirely.
        // preventDefault has to happen synchronously, so the close is always
        // blocked first and completed below if nothing turns up.
        event.preventDefault();
        checking.current = true;
        setPrompting("checking");
        await refreshMissing("close");
        checking.current = false;
        if (getMissing().length > 0) {
          setPrompting("missing");
        } else {
          // Nothing pending (or the check failed and the last known list was
          // empty) — quitting must not hinge on Jira being reachable.
          getCurrentWindow().destroy();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  if (prompting === "checking") {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h3>Checking for unlogged work…</h3>
          <p className="modal-sub">
            Asking Jira whether anything from the last hours is still unlogged.
          </p>
          <div className="row">
            <button
              className="danger"
              onClick={() => getCurrentWindow().destroy()}
            >
              Quit anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (prompting === "timer" && timer) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h3>Timer still running</h3>
          <p className="modal-sub">
            <span className="key">{timer.issueKey}</span> has been timing for{" "}
            <span className="clock-inline">{formatClock(elapsed)}</span>.
            Quitting now discards the tracked time — stop the timer to log it
            first.
          </p>
          <div className="row">
            <button className="secondary" onClick={() => setPrompting(null)}>
              Keep working
            </button>
            <button
              className="danger"
              onClick={() => getCurrentWindow().destroy()}
            >
              Quit anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (prompting === "missing" && missing.length > 0) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h3>Unlogged work</h3>
          <p className="modal-sub">
            {missing.length === 1
              ? "One issue in the Missing worklog tab has"
              : `${missing.length} issues in the Missing worklog tab have`}{" "}
            recent activity without logged time. Log it before you quit — it is
            easier now than tomorrow.
          </p>
          <div className="row">
            <button className="secondary" onClick={() => setPrompting(null)}>
              Go back
            </button>
            <button
              className="danger"
              onClick={() => getCurrentWindow().destroy()}
            >
              Quit anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
