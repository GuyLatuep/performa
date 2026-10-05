import { X } from "lucide-react";
import { useState } from "react";
import { openExternal } from "../external";
import {
  DISMISSED_KEY,
  installUpdate,
  progressLabel,
  RELEASES_URL,
  useUpdateState,
} from "../updates";

// Banner shown when a newer release exists on GitHub. "Update & restart"
// downloads and installs it in place; dismissing hides the banner for that
// version only — the next release brings it back, and so does asking for a
// check in Settings.
//
// The checking itself lives in `updates.ts`, on a timer started at launch:
// this only shows what that found.
export default function UpdateNotice() {
  const state = useUpdateState();
  // Bumped on dismissal so the read of localStorage below happens again.
  const [, setDismissals] = useState(0);

  if (state.kind !== "available" && state.kind !== "installing") return null;
  const { update } = state;
  if (
    state.kind === "available" &&
    localStorage.getItem(DISMISSED_KEY) === update.version
  ) {
    return null;
  }

  return (
    <div className="update-notice">
      <span>
        Update <strong>{update.version}</strong> is available — you are on{" "}
        {update.currentVersion}.
      </span>
      {state.kind === "available" && state.installError && (
        <span className="update-error">
          Update failed: {state.installError}
        </span>
      )}
      {state.kind === "installing" ? (
        <span className="update-progress">{progressLabel(state.progress)}</span>
      ) : (
        <>
          <button className="link" onClick={() => void installUpdate()}>
            Update &amp; restart
          </button>
          <button className="link" onClick={() => openExternal(RELEASES_URL)}>
            Release notes
          </button>
          <button
            className="icon"
            title="Dismiss for this version"
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, update.version);
              setDismissals((n) => n + 1);
            }}
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
