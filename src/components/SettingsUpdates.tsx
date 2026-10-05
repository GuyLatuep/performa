import {
  checkForUpdates,
  installUpdate,
  progressLabel,
  UpdateState,
  useUpdateState,
} from "../updates";

/**
 * Ask for a newer release now, rather than waiting for the hourly check.
 *
 * Settings replaces the app screen, banner included, so whatever a check finds
 * is answered here as well: the status says what came back, and an update on
 * offer can be installed from this screen without leaving it.
 */
export default function SettingsUpdates() {
  const state = useUpdateState();
  const busy = state.kind === "checking" || state.kind === "installing";

  return (
    <div className="field-block">
      <span className="field-label">Updates</span>
      <div className="hours-field">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void checkForUpdates({ manual: true })}
        >
          Check for updates
        </button>
        {state.kind === "available" && (
          <button type="button" onClick={() => void installUpdate()}>
            Update &amp; restart
          </button>
        )}
      </div>
      {/* Polite: the answer to a button press, read once it arrives. */}
      <span className="hint" role="status" aria-live="polite">
        {describe(state)}
      </span>
      {state.kind === "available" && state.installError && (
        <p className="error">Update failed: {state.installError}</p>
      )}
      {state.kind === "failed" && (
        <p className="error">Couldn’t check for updates: {state.message}</p>
      )}
    </div>
  );
}

function describe(state: UpdateState): string {
  switch (state.kind) {
    case "idle":
    case "failed":
      return "performa also checks by itself every hour.";
    case "checking":
      return "Checking…";
    case "current":
      return `You’re on the latest version · checked at ${time(state.at)}`;
    case "available":
      return `Version ${state.update.version} is available — you are on ${state.update.currentVersion}.`;
    case "installing":
      return progressLabel(state.progress);
  }
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
