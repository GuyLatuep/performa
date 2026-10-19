import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, CredentialsMeta } from "../api";
import {
  applyImport,
  checkImport,
  exportSettings,
  settingsFileName,
} from "../settingsTransfer";

const FILE_FILTERS = [{ name: "performa settings", extensions: ["json"] }];

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "exported"; path: string }
  | {
      kind: "confirming";
      settings: Record<string, string>;
      otherAccount: boolean;
      hasDrafts: boolean;
    }
  | { kind: "failed"; message: string };

/**
 * Take the settings to another computer: export them to a file here, import
 * that file there. Signed-in only — the file carries no credentials, so the
 * new machine is connected first and the import lands on that account.
 */
export default function SettingsTransfer({
  account,
}: {
  account: CredentialsMeta;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy";

  async function exportToFile() {
    try {
      const path = await save({
        defaultPath: settingsFileName(),
        filters: FILE_FILTERS,
      });
      // Cancelling the dialog is not an error; it is the user saying no.
      if (!path) return;
      setState({ kind: "busy" });
      const text = exportSettings(await getVersion(), account);
      await api.writeSettingsFile(path, text);
      setState({ kind: "exported", path });
    } catch (err) {
      setState({ kind: "failed", message: `Couldn’t export: ${err}` });
    }
  }

  async function pickImport() {
    try {
      const path = await open({ multiple: false, filters: FILE_FILTERS });
      if (typeof path !== "string") return;
      setState({ kind: "busy" });
      const check = checkImport(await api.readSettingsFile(path), account);
      setState(
        check.ok
          ? { kind: "confirming", ...check }
          : { kind: "failed", message: check.reason },
      );
    } catch (err) {
      setState({ kind: "failed", message: `Couldn’t import: ${err}` });
    }
  }

  async function replace() {
    if (state.kind !== "confirming") return;
    applyImport(state.settings, account);
    setState({ kind: "busy" });
    try {
      await relaunch();
    } catch (err) {
      // Written already; only the restart failed, and quitting by hand does it.
      setState({
        kind: "failed",
        message: `Settings imported — restart performa to apply them (${err}).`,
      });
    }
  }

  return (
    <div className="field-block">
      <span className="field-label">Transfer settings</span>
      {state.kind === "confirming" ? (
        <>
          <div className="hours-field">
            <span className="confirm-text">
              Replace your settings with the imported ones?
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => setState({ kind: "idle" })}
            >
              Keep
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void replace()}
            >
              Replace
            </button>
          </div>
          {state.otherAccount && (
            <p className="error">
              This file comes from another Jira account, or doesn’t say which.
              Saved searches, the issue field layout and hidden Todo statuses
              name that site’s fields, projects and statuses, and may not work
              here.
            </p>
          )}
          <span className="hint">
            performa restarts to apply them.
            {state.hasDrafts &&
              " Parked time (drafts) on the old computer is not removed — book it in one place only."}
          </span>
        </>
      ) : (
        <>
          <div className="hours-field">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void exportToFile()}
            >
              Export…
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void pickImport()}
            >
              Import…
            </button>
          </div>
          <span className="hint" role="status" aria-live="polite">
            {state.kind === "exported"
              ? `Saved to ${state.path}`
              : "Move your settings to another computer. Your Jira login is not included — sign in there first, then import."}
          </span>
          {state.kind === "failed" && <p className="error">{state.message}</p>}
        </>
      )}
    </div>
  );
}
