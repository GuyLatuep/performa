import { FormEvent, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta } from "../api";

interface Props {
  existing: CredentialsMeta | null;
  onSaved: () => void;
  /** Discard the live-previewed settings and leave (absent on first run). */
  onCancel?: () => void;
}

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** Jira site, account and API token. The only tab that talks to the backend
 *  on save — everything else applies straight to the local stores. */
export default function SettingsConnection({
  existing,
  onSaved,
  onCancel,
}: Props) {
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
    <>
      <p className="muted">
        Connect your Jira Cloud site to start logging hours. Your API token is
        kept in the{" "}
        {navigator.platform.startsWith("Mac") ? "macOS Keychain" : "OS keychain"}{" "}
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
            placeholder={existing ? "•••••••• (unchanged — enter to replace)" : ""}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required={!existing}
          />
          {existing && (
            <span className="hint">
              Required again when you change the site or email — a stored token
              is never sent to a different connection.
            </span>
          )}
        </label>

        <button type="button" className="link" onClick={() => openUrl(TOKEN_URL)}>
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
    </>
  );
}
