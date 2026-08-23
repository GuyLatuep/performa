import { useCallback, useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, Attachment } from "../api";
import { formatBytes } from "../files";
import { timeAgo } from "../time";
import { logInfo } from "../log";

/** The issue's files: open one, or add more by dropping them on the window or
 *  picking them.
 *
 *  Both ways in are offered on purpose — dropping is the fast path for a file
 *  already on screen, and the picker is the only discoverable one. */
export default function IssueAttachments({
  issueKey,
  attachments,
  onAttached,
}: {
  issueKey: string;
  attachments: Attachment[];
  onAttached: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  /** The file whose cross has been clicked, waiting to be confirmed. Deleting
   *  is irreversible and removes the file for everyone on the issue, so it
   *  takes two clicks — and the second one is labelled, not another cross. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const upload = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        await api.attachFiles(issueKey, paths);
        logInfo(`attached ${paths.length} file(s) to ${issueKey}`);
        onAttached();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [issueKey, onAttached],
  );

  // Suppress the webview's own idea of what a dropped file means.
  //
  // Tauri takes file drops at the native layer, but WebKit still runs its
  // default DOM handling on the way past — and over a text field that means
  // showing an insertion caret and the file's *name*, as if dropping would
  // paste "Screenshot 2026-08-22 at 18.25.21" into the box. It would not: the
  // file gets attached. Cancelling the DOM events removes the affordance
  // without touching the native drop that does the real work.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      // Only for files. Dragging selected text within a textarea is ordinary
      // editing and stays as it is.
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // Files dropped anywhere on the window land on the open issue: the issue
  // view fills the window, so there is no second target to be confused with.
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setDropping(true);
        } else if (event.payload.type === "drop") {
          setDropping(false);
          void upload(event.payload.paths);
        } else {
          setDropping(false);
        }
      })
      .then(
        (unlisten) => {
          if (disposed) unlisten();
          else stop = unlisten;
        },
        // Drag-and-drop is the convenience path; the picker still works.
        (err) => logInfo(`drag-and-drop unavailable: ${err}`),
      );
    return () => {
      disposed = true;
      stop?.();
    };
  }, [upload]);

  async function pick() {
    const picked = await openFileDialog({ multiple: true });
    if (!picked) return;
    await upload(Array.isArray(picked) ? picked : [picked]);
  }

  async function remove(item: Attachment) {
    setRemoving(item.id);
    setError(null);
    try {
      await api.deleteAttachment(item.id);
      logInfo(`deleted attachment ${item.filename} from ${issueKey}`);
      setConfirming(null);
      onAttached();
    } catch (err) {
      setError(String(err));
    } finally {
      setRemoving(null);
    }
  }

  async function openOne(item: Attachment) {
    setOpening(item.id);
    setError(null);
    try {
      await api.openAttachment(item.id, item.filename);
    } catch (err) {
      setError(String(err));
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className={`attachments${dropping ? " dropping" : ""}`}>
      <ul className="attachment-list">
        {attachments.map((item) => (
          <li key={item.id}>
            <button
              className="link attachment-name"
              title={`Open ${item.filename}`}
              disabled={opening !== null}
              onClick={() => openOne(item)}
            >
              {opening === item.id ? "Opening…" : item.filename}
            </button>
            <span className="attachment-meta">
              {formatBytes(item.size)} · {item.author}
              {item.createdAt && ` · ${timeAgo(item.createdAt)}`}
            </span>
            <span className="attachment-actions">
              {confirming === item.id ? (
                <>
                  <span className="confirm-text">Delete for everyone?</span>
                  <button
                    className="icon"
                    title="Keep the file"
                    disabled={removing !== null}
                    onClick={() => setConfirming(null)}
                  >
                    ✕
                  </button>
                  <button
                    className="icon danger-icon"
                    title={`Delete ${item.filename} from this issue`}
                    disabled={removing !== null}
                    onClick={() => remove(item)}
                  >
                    ✓
                  </button>
                </>
              ) : (
                <button
                  className="icon attachment-remove"
                  title={`Delete ${item.filename} from this issue`}
                  disabled={removing !== null || busy}
                  onClick={() => setConfirming(item.id)}
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
        {attachments.length === 0 && (
          <li className="muted empty">No files on this issue.</li>
        )}
      </ul>

      {error && <p className="error">{error}</p>}

      <div className="comment-actions">
        <button className="secondary" onClick={pick} disabled={busy}>
          {busy ? "Attaching…" : "Attach files…"}
        </button>
        {attachments.length > 0 && (
          <button className="link" onClick={() => api.openAttachmentFolder()}>
            Open download folder ↗
          </button>
        )}
      </div>
      <p className="hint">
        Or drop files on the window. Opened files are downloaded to a scratch
        folder the app clears at launch — save anything you want to keep.
      </p>
    </div>
  );
}
