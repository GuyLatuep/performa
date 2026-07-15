import { useState, FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta } from "../api";

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
      <h1>performa</h1>
      <p className="muted">
        Log your Jira work hours. Enter your Jira Cloud site and an API token.
        Your token is stored securely in the OS keychain and never leaves this
        machine.
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
