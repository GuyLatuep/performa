import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, UpdateInfo } from "../api";

const DISMISSED_KEY = "performa-update-dismissed";
const CHECK_MS = 6 * 60 * 60 * 1000;

// Banner shown when a newer release exists on GitHub. Dismissing hides it
// for that version only — the next release brings it back.
export default function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const info = await api.checkUpdate();
        if (!cancelled && info.isNewer) setUpdate(info);
      } catch {
        // Update checks are best-effort; stay quiet on failure.
      }
    }
    check();
    const id = window.setInterval(check, CHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!update) return null;
  if (localStorage.getItem(DISMISSED_KEY) === update.latestVersion) return null;

  return (
    <div className="update-notice">
      <span>
        Update <strong>{update.latestVersion}</strong> is available — you are
        on {update.currentVersion}.
      </span>
      <button className="link" onClick={() => openUrl(update.downloadUrl)}>
        Open download page
      </button>
      <button
        className="icon"
        title="Dismiss for this version"
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, update.latestVersion);
          setUpdate(null);
        }}
      >
        ✕
      </button>
    </div>
  );
}
