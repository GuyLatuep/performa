import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const DISMISSED_KEY = "performa-update-dismissed";
const CHECK_MS = 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/GuyLatuep/performa/releases/latest";

// Banner shown when a newer release exists on GitHub. "Update & restart"
// downloads and installs it in place; dismissing hides the banner for that
// version only — the next release brings it back.
export default function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const found = await check();
        if (!cancelled && found && !installing.current) setUpdate(found);
      } catch {
        // Update checks are best-effort; stay quiet on failure.
      }
    }
    run();
    const id = window.setInterval(run, CHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!update) return null;
  if (localStorage.getItem(DISMISSED_KEY) === update.version) return null;

  async function install() {
    if (!update || installing.current) return;
    installing.current = true;
    setError(null);
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            received += event.data.chunkLength;
            if (total > 0) {
              setProgress(Math.min(100, Math.round((received / total) * 100)));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      await relaunch();
    } catch (err) {
      installing.current = false;
      setProgress(null);
      setError(String(err));
    }
  }

  return (
    <div className="update-notice">
      <span>
        Update <strong>{update.version}</strong> is available — you are on{" "}
        {update.currentVersion}.
      </span>
      {error && <span className="update-error">Update failed: {error}</span>}
      {progress !== null ? (
        <span className="update-progress">
          {progress < 100 ? `Downloading… ${progress}%` : "Installing…"}
        </span>
      ) : (
        <>
          <button className="link" onClick={install}>
            Update &amp; restart
          </button>
          <button className="link" onClick={() => openUrl(RELEASES_URL)}>
            Release notes
          </button>
        </>
      )}
      {progress === null && (
        <button
          className="icon"
          title="Dismiss for this version"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, update.version);
            setUpdate(null);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
