import { useState, FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta } from "../api";
import ThemeToggle from "./ThemeToggle";
import Blockmark from "./Blockmark";

interface Props {
  existing: CredentialsMeta | null;
  onSaved: () => void;
  onCancel?: () => void;
}

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export default function Setup({ existing, onSaved, onCancel }: Props) {
  const [site, setSite] = useState(existing?.site ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            {busy ? "Verifying…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
