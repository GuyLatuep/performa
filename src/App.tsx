import { useEffect, useState } from "react";
import { api, CredentialsMeta } from "./api";
import Setup from "./components/Setup";
import LogWork from "./components/LogWork";
import Timesheet from "./components/Timesheet";
import TimerBar from "./components/TimerBar";
import "./App.css";

type Tab = "log" | "timesheet";

export default function App() {
  const [creds, setCreds] = useState<CredentialsMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingCreds, setEditingCreds] = useState(false);
  const [tab, setTab] = useState<Tab>("log");
  const [refreshKey, setRefreshKey] = useState(0);

  async function refreshStatus() {
    setCreds(await api.credentialsStatus());
    setLoaded(true);
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  if (!creds || editingCreds) {
    return (
      <Setup
        existing={creds}
        onCancel={editingCreds ? () => setEditingCreds(false) : undefined}
        onSaved={async () => {
          setEditingCreds(false);
          await refreshStatus();
        }}
      />
    );
  }

  async function signOut() {
    if (!confirm("Remove stored credentials from this machine?")) return;
    await api.clearCredentials();
    await refreshStatus();
  }

  return (
    <div className="app">
      <header>
        <div className="brand">performa</div>
        <div className="account">
          <span className="muted">{creds.email}</span>
          <button className="link" onClick={() => setEditingCreds(true)}>
            Settings
          </button>
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <TimerBar onLogged={() => setRefreshKey((k) => k + 1)} />

      <nav className="tabs">
        <button
          className={tab === "log" ? "active" : ""}
          onClick={() => setTab("log")}
        >
          Log work
        </button>
        <button
          className={tab === "timesheet" ? "active" : ""}
          onClick={() => setTab("timesheet")}
        >
          Timesheet
        </button>
      </nav>

      <main>
        {tab === "log" ? (
          <LogWork onLogged={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <Timesheet refreshKey={refreshKey} />
        )}
      </main>
    </div>
  );
}
