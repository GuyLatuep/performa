import { useEffect, useRef, useState, FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta } from "../api";
import { LOG_LEVELS, LogLevel } from "../log";
import {
  getDailyHours,
  getLogLevel,
  getShowWeekends,
  setDailyHours,
  setLogLevel,
  setShowWeekends,
  useLogLevel,
  useShowWeekends,
} from "../settings";
import { getTheme, setTheme } from "../theme";
import { getAccent, setAccent } from "../accent";
import ThemeToggle from "./ThemeToggle";
import AccentPicker from "./AccentPicker";
import Blockmark from "./Blockmark";

interface Props {
  existing: CredentialsMeta | null;
  onSaved: () => void;
  onCancel?: () => void;
}

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

type SettingsTab = "connection" | "appearance" | "timesheet" | "logging";

/** First-run connect screen; doubles as the settings page once signed in. */
export default function Settings({ existing, onSaved, onCancel }: Props) {
  const [site, setSite] = useState(existing?.site ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [hours, setHours] = useState(String(getDailyHours()));
  const showWeekends = useShowWeekends();
  const logLevel = useLogLevel();
  const [logFolderError, setLogFolderError] = useState<string | null>(null);
  // Editing an existing connection lands on Appearance — that's the more
  // common reason to reopen this screen. First run has to start on
  // Connection since nothing else matters until it's set up.
  const [tab, setTab] = useState<SettingsTab>(
    existing ? "appearance" : "connection",
  );

  // Theme, accent, hours, weekend toggle, and log level apply instantly
  // (live preview), so keep a snapshot from when the screen opened and
  // restore it on Cancel.
  const snapshot = useRef({
    theme: getTheme(),
    accent: getAccent(),
    hours: getDailyHours(),
    weekends: getShowWeekends(),
    logLevel: getLogLevel(),
  });

  function cancel() {
    setTheme(snapshot.current.theme);
    setAccent(snapshot.current.accent);
    setDailyHours(snapshot.current.hours);
    setShowWeekends(snapshot.current.weekends);
    setLogLevel(snapshot.current.logLevel);
    onCancel?.();
  }

  async function openLogFolder() {
    setLogFolderError(null);
    try {
      await api.openLogFolder();
    } catch (err) {
      setLogFolderError(String(err));
    }
  }

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveCredentials(site, email, token);
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup-mark">
        <Blockmark />
      </div>
      <span className="eyebrow">Time ledger · Jira</span>
      <h1>performa</h1>

      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "connection"}
          className={tab === "connection" ? "active" : ""}
          onClick={() => setTab("connection")}
        >
          Connection
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "appearance"}
          className={tab === "appearance" ? "active" : ""}
          onClick={() => setTab("appearance")}
        >
          Appearance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "timesheet"}
          className={tab === "timesheet" ? "active" : ""}
          onClick={() => setTab("timesheet")}
        >
          Timesheet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "logging"}
          className={tab === "logging" ? "active" : ""}
          onClick={() => setTab("logging")}
        >
          Logging
        </button>
      </div>

      {tab === "connection" && (
        <>
          <p className="muted">
            Connect your Jira Cloud site to start logging hours. Your API
            token is kept in the{" "}
            {navigator.platform.startsWith("Mac")
              ? "macOS Keychain"
              : "OS keychain"}{" "}
            and never leaves this machine.
          </p>

          <form onSubmit={submit}>
            <label>
              Jira site
              <input
                type="text"
                placeholder="your-team.atlassian.net"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                autoFocus
                required
              />
            </label>

            <label>
              Email
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label>
              API token
              <input
                type="password"
                placeholder={
                  existing ? "•••••••• (unchanged — enter to replace)" : ""
                }
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required={!existing}
              />
            </label>

            <button
              type="button"
              className="link"
              onClick={() => openUrl(TOKEN_URL)}
            >
              Create an API token ↗
            </button>

            {error && <p className="error">{error}</p>}

            <div className="row">
              {onCancel && (
                <button type="button" className="secondary" onClick={cancel}>
                  Cancel
                </button>
              )}
              <button type="submit" disabled={busy}>
                {busy ? "Verifying…" : existing ? "Save" : "Connect"}
              </button>
            </div>
          </form>
        </>
      )}

      {tab === "appearance" && (
        <>
          <div className="field-block">
            <span className="field-label">Theme</span>
            <ThemeToggle />
          </div>

          <div className="field-block">
            <span className="field-label">Accent color</span>
            <AccentPicker />
          </div>
        </>
      )}

      {tab === "timesheet" && (
        <>
          <div className="field-block">
            <span className="field-label">Daily work hours</span>
            <div className="hours-field">
              <input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setDailyHours(parseFloat(e.target.value));
                }}
                onBlur={() => setHours(String(getDailyHours()))}
              />
              <span className="hint">
                h per day · sets the timesheet targets
              </span>
            </div>
          </div>

          <div className="field-block">
            <span className="field-label">Timesheet days</span>
            <div className="theme-toggle">
              <button
                type="button"
                className={showWeekends ? "" : "active"}
                onClick={() => setShowWeekends(false)}
              >
                Mon–Fri
              </button>
              <button
                type="button"
                className={showWeekends ? "active" : ""}
                onClick={() => setShowWeekends(true)}
              >
                Full week
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "logging" && (
        <div className="field-block">
          <span className="field-label">Logging</span>
          <div className="hours-field">
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value as LogLevel)}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={openLogFolder}>
              Open log folder
            </button>
          </div>
          <span className="hint">
            Debug log level · files are written to a temp folder, newest 3
            kept
          </span>
          {logFolderError && <p className="error">{logFolderError}</p>}
        </div>
      )}

      {tab !== "connection" && onCancel && (
        <div className="row">
          <button type="button" className="secondary" onClick={cancel}>
            Cancel
          </button>
          {/* Theme/accent/hours/weekends/log level are already live in the
              stores as they're changed, so "Save" is just closing without
              rolling back to the snapshot — unlike Cancel above. */}
          <button type="button" onClick={onCancel}>
            Save
          </button>
        </div>
      )}

      <p className="buildinfo">
        v{version} · built {__BUILT_AT__.slice(0, 16).replace("T", " ")} UTC
      </p>
    </div>
  );
}
