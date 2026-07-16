import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatClock, getTimer, useElapsedSeconds, useTimer } from "../timer";
import { getMissing, useMissing } from "../missing";

type Prompt = "timer" | "missing" | null;

// Intercepts the window close: if a timer is still running or unlogged-work
// reminders are pending, block the close and warn in-app (native confirm()
// dialogs are no-ops in Tauri's webview).
export default function CloseGuard() {
  const [prompting, setPrompting] = useState<Prompt>(null);
  const timer = useTimer();
  const missing = useMissing();
  const elapsed = useElapsedSeconds(prompting === "timer" ? timer : null);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested((event) => {
        // Read the live stores (not stale closures) to decide.
        if (getTimer()) {
          event.preventDefault();
          setPrompting("timer");
        } else if (getMissing().length > 0) {
          event.preventDefault();
          setPrompting("missing");
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  if (prompting === "timer" && timer) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h3>Timer still running</h3>
          <p className="modal-sub">
            <span className="key">{timer.issueKey}</span> has been timing for{" "}
            <span className="clock-inline">{formatClock(elapsed)}</span>. Quitting
            now discards the tracked time — stop the timer to log it first.
          </p>
          <div className="row">
            <button className="secondary" onClick={() => setPrompting(null)}>
              Keep working
            </button>
            <button className="danger" onClick={() => getCurrentWindow().destroy()}>
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
            <button className="danger" onClick={() => getCurrentWindow().destroy()}>
              Quit anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
