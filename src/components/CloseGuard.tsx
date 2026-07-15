import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatClock, getTimer, useElapsedSeconds, useTimer } from "../timer";

// Intercepts the window close: if a timer is still running, block the close and
// warn in-app (native confirm() dialogs are no-ops in Tauri's webview).
export default function CloseGuard() {
  const [prompting, setPrompting] = useState(false);
  const timer = useTimer();
  const elapsed = useElapsedSeconds(prompting ? timer : null);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested((event) => {
        // Read the live timer (not a stale closure) to decide.
        if (getTimer()) {
          event.preventDefault();
          setPrompting(true);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  if (!prompting || !timer) return null;

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
          <button className="secondary" onClick={() => setPrompting(false)}>
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
