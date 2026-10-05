import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logDebug } from "./log";
import { createStore } from "./store";

/** How often the app looks for a release by itself. */
export const CHECK_MS = 60 * 60 * 1000;

/** Where "Release notes" goes. */
export const RELEASES_URL =
  "https://github.com/GuyLatuep/performa/releases/latest";

/** Where a dismissal of the banner is kept: the version it was for. */
export const DISMISSED_KEY = "performa-update-dismissed";

/**
 * What is known about a newer release.
 *
 * One store rather than state inside the banner, because two places show it:
 * the banner over the tabs, and the Updates section in Settings — and Settings
 * replaces the whole app screen while it is open, banner included. Kept here,
 * the hourly check goes on while Settings is up, and a check asked for there
 * leaves its answer for the banner to show on the way out.
 */
export type UpdateState =
  /** Nothing asked yet: the first check has not come back. */
  | { kind: "idle" }
  | { kind: "checking" }
  /** Asked, and this is the newest. `at` is when, for "last checked". */
  | { kind: "current"; at: number }
  /** A newer release. `installError` when an attempt to install it failed. */
  | { kind: "available"; update: Update; installError?: string }
  /** Downloading (0–99) or installing (100), then the app restarts. */
  | { kind: "installing"; update: Update; progress: number }
  /** A check somebody asked for failed. A background one never lands here. */
  | { kind: "failed"; message: string };

const store = createStore<UpdateState>({ kind: "idle" });

export function getUpdateState(): UpdateState {
  return store.get();
}

export function useUpdateState(): UpdateState {
  return store.use();
}

/** The check in flight, so a second ask joins it rather than racing it. */
let inFlight: Promise<void> | null = null;

/**
 * Ask whether a newer release exists.
 *
 * `manual` is a person pressing "Check for updates", and changes two things.
 * A failure is shown to them — they asked — where a background failure only
 * goes to the log, since a GitHub outage must not put an error in front of
 * somebody logging time. And a version they once dismissed comes back: asking
 * is saying they want to hear about it now.
 */
export function checkForUpdates({ manual = false } = {}): Promise<void> {
  // An install is underway; its update is already the answer.
  if (store.get().kind === "installing") return Promise.resolve();
  if (inFlight) return inFlight;

  const before = store.get();
  if (manual) store.set({ kind: "checking" });

  inFlight = (async () => {
    try {
      const found = await check();
      if (store.get().kind === "installing") return;
      if (found) {
        if (manual) forgetDismissal(found.version);
        store.set({ kind: "available", update: found });
      } else {
        store.set({ kind: "current", at: Date.now() });
      }
    } catch (err) {
      logDebug(`update check failed: ${err}`);
      store.set(
        manual
          ? { kind: "failed", message: String(err) }
          : // Whatever was known before still stands.
            before.kind === "checking"
            ? { kind: "idle" }
            : before,
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function forgetDismissal(version: string): void {
  try {
    if (localStorage.getItem(DISMISSED_KEY) === version) {
      localStorage.removeItem(DISMISSED_KEY);
    }
  } catch {
    // Storage unavailable: nothing was remembered to forget.
  }
}

/** Download and install the update on offer, then restart into it. */
export async function installUpdate(): Promise<void> {
  const state = store.get();
  if (state.kind !== "available") return;
  const { update } = state;

  store.set({ kind: "installing", update, progress: 0 });
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
            store.set({
              kind: "installing",
              update,
              progress: Math.min(100, Math.round((received / total) * 100)),
            });
          }
          break;
        case "Finished":
          store.set({ kind: "installing", update, progress: 100 });
          break;
      }
    });
    await relaunch();
  } catch (err) {
    store.set({ kind: "available", update, installError: String(err) });
  }
}

/** What an install in progress says about itself, in the banner and Settings. */
export function progressLabel(progress: number): string {
  return progress < 100 ? `Downloading… ${progress}%` : "Installing…";
}

/**
 * Check now, and then every hour for as long as the app runs.
 *
 * Started once, at launch, outside any component: the banner that used to own
 * the timer unmounts whenever Settings or About is open, and the clock stopped
 * with it. Returns the way to stop, for tests.
 */
export function startUpdateChecks(): () => void {
  void checkForUpdates();
  const id = window.setInterval(() => void checkForUpdates(), CHECK_MS);
  return () => window.clearInterval(id);
}

/** Back to nothing known. For tests, whose module state outlives one of them. */
export function resetUpdateState(): void {
  inFlight = null;
  store.set({ kind: "idle" });
}
