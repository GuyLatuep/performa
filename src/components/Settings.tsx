import { useEffect, useState, FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta } from "../api";
import {
  getDailyHours,
  setDailyHours,
  setShowWeekends,
  useShowWeekends,
} from "../settings";
import ThemeToggle from "./ThemeToggle";
import Blockmark from "./Blockmark";

interface Props {
  existing: CredentialsMeta | null;
  onSaved: () => void;
  onCancel?: () => void;
}

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

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
      <p className="muted">
        Connect your Jira Cloud site to start logging hours. Your API token is
        kept in the {navigator.platform.startsWith("Mac") ? "macOS Keychain" : "OS keychain"} and never leaves this machine.
      </p>

      <div className="field-block">
        <span className="field-label">Appearance</span>
        <ThemeToggle />
      </div>

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
          <span className="hint">h per day · sets the timesheet targets</span>
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
            placeholder={existing ? "•••••••• (enter to update)" : ""}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
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
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Verifying…" : existing ? "Save" : "Connect"}
          </button>
        </div>
      </form>

      <p className="buildinfo">
        v{version} · built {__BUILT_AT__.slice(0, 16).replace("T", " ")} UTC
      </p>
    </div>
  );
}
