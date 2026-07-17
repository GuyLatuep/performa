import { useEffect, useState } from "react";
import { api, CredentialsMeta } from "./api";
import Settings from "./components/Settings";
import LogWork from "./components/LogWork";
import Timesheet from "./components/Timesheet";
import TimerBar from "./components/TimerBar";
import MissingWorklogs from "./components/MissingWorklogs";
import UpdateNotice from "./components/UpdateNotice";
import Blockmark from "./components/Blockmark";
import {
  refreshMissing,
  startMissingPolling,
  stopMissingPolling,
  useMissing,
  useMissingUnseenCount,
} from "./missing";
import "./App.css";

type Tab = "log" | "timesheet" | "missing";

export default function App() {
  const [creds, setCreds] = useState<CredentialsMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingCreds, setEditingCreds] = useState(false);
  const [tab, setTab] = useState<Tab>("log");
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const missingItems = useMissing();
  const missingUnseen = useMissingUnseenCount();

  async function refreshStatus() {
    try {
      setCreds(await api.credentialsStatus());
      setLoadError(null);
    } catch (err) {
      // A keychain read failure must not leave the app stuck on "Loading…".
      setLoadError(String(err));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  // Watch for unlogged activity in the background while signed in.
  const signedIn = !!creds;
  useEffect(() => {
    if (!signedIn) return;
    startMissingPolling();
    return stopMissingPolling;
  }, [signedIn]);

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  if (loadError && !creds) {
    return (
      <div className="setup">
        <span className="eyebrow">Time ledger · Jira</span>
        <h1>performa</h1>
        <p className="error">Could not read stored credentials: {loadError}</p>
        <button
          onClick={() => {
            setLoaded(false);
            refreshStatus();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!creds || editingCreds) {
    return (
      <Settings
        existing={creds}
        onCancel={editingCreds ? () => setEditingCreds(false) : undefined}
        onSaved={async () => {
          setEditingCreds(false);
          await refreshStatus();
        }}
      />
    );
  }

  async function doSignOut() {
    setConfirmSignOut(false);
    await api.clearCredentials();
    await refreshStatus();
  }

  function onLogged() {
    setRefreshKey((k) => k + 1);
    // A fresh worklog may resolve a reminder — recheck right away.
    refreshMissing();
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <Blockmark />
          performa
        </div>
        <div className="account">
          <span className="muted">{creds.email}</span>
          <button className="link" onClick={() => setEditingCreds(true)}>
            Settings
          </button>
          {confirmSignOut ? (
            <>
              <span className="confirm-text">Sign out?</span>
              <button className="link" onClick={doSignOut}>
                Yes
              </button>
              <button className="link" onClick={() => setConfirmSignOut(false)}>
                No
              </button>
            </>
          ) : (
            <button className="link" onClick={() => setConfirmSignOut(true)}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <UpdateNotice />

      <TimerBar onLogged={onLogged} />

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
        <button
          className={`${tab === "missing" ? "active" : ""}${
            missingUnseen > 0 ? " alert" : ""
          }`}
          onClick={() => setTab("missing")}
        >
          Missing worklog
          {missingItems.length > 0 && ` · ${missingItems.length}`}
        </button>
      </nav>

      <main>
        {tab === "log" && <LogWork site={creds.site} onLogged={onLogged} />}
        {tab === "timesheet" && <Timesheet site={creds.site} refreshKey={refreshKey} />}
        {tab === "missing" && <MissingWorklogs site={creds.site} onLogged={onLogged} />}
      </main>
    </div>
  );
}
