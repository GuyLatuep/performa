import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, CredentialsMeta, IssueSummary } from "./api";
import { logInfo } from "./log";
import Settings from "./components/Settings";
import Start from "./components/Start";
import Todo from "./components/Todo";
import LogWork from "./components/LogWork";
import Timesheet from "./components/Timesheet";
import TimerBar from "./components/TimerBar";
import MissingWorklogs from "./components/MissingWorklogs";
import Mentions from "./components/Mentions";
import UpdateNotice from "./components/UpdateNotice";
import WhatsNew from "./components/WhatsNew";
import Blockmark from "./components/Blockmark";
import {
  refreshMissing,
  startMissingPolling,
  stopMissingPolling,
  useMissing,
  useMissingUnseenCount,
} from "./missing";
import {
  startMentionsPolling,
  stopMentionsPolling,
  useMentionsUnreadCount,
} from "./mentions";
import "./App.css";

type Tab = "start" | "todo" | "log" | "timesheet" | "missing" | "mentions";

const TAB_LABELS: Record<Tab, string> = {
  start: "Start",
  todo: "Todo",
  log: "Log work",
  timesheet: "Timesheet",
  missing: "Missing worklog",
  mentions: "Mentions",
};

// The English manual links to the German one via its language switcher.
const HANDBOOK_URL =
  "https://github.com/GuyLatuep/performa/blob/main/docs/user-manual.en.md";

export default function App() {
  const [creds, setCreds] = useState<CredentialsMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingCreds, setEditingCreds] = useState(false);
  // Settings tab to land on when the screen is opened from somewhere with an
  // opinion about it (the todo-filter notice); cleared on the way out.
  const [settingsTab, setSettingsTab] = useState<"todo" | undefined>();
  const [tab, setTab] = useState<Tab>("start");
  const [refreshKey, setRefreshKey] = useState(0);
  // Issue picked on the start tab, opened directly in the log-work form.
  const [logIssue, setLogIssue] = useState<IssueSummary | null>(null);
  // Counts entries into the log tab. Used as LogWork's key so every visit
  // remounts it: the component keeps the picked issue in its own state, which
  // a changed `initialIssue` alone would not clear — least of all when it
  // changes from "no issue" to "no issue" (see `openLogTab`).
  const [logVisit, setLogVisit] = useState(0);
  // Tab the log form was opened from, so it can offer a way straight back
  // there. Null for a manual visit to the log tab — there is nowhere to return.
  const [logOrigin, setLogOrigin] = useState<Tab | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const missingItems = useMissing();
  const missingUnseen = useMissingUnseenCount();
  const mentionsUnread = useMentionsUnreadCount();

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

  // Same for @-mentions — the tab badge has to be right before it is opened.
  useEffect(() => {
    if (!signedIn) return;
    startMentionsPolling();
    return stopMentionsPolling;
  }, [signedIn]);

  // A single choke point for "which view is the user in" — covers every way
  // a tab can change (nav click, start-tab shortcuts) without instrumenting
  // each one individually.
  useEffect(() => {
    if (signedIn) logInfo(`view: ${tab}`);
  }, [signedIn, tab]);

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
        initialTab={settingsTab}
        onCancel={
          editingCreds
            ? () => {
                setEditingCreds(false);
                setSettingsTab(undefined);
              }
            : undefined
        }
        onSaved={async () => {
          setEditingCreds(false);
          setSettingsTab(undefined);
          await refreshStatus();
        }}
      />
    );
  }

  async function doSignOut() {
    setConfirmSignOut(false);
    logInfo("user signed out");
    await api.clearCredentials();
    await refreshStatus();
  }

  /** Open the log-work tab, optionally with an issue preselected. */
  function openLogTab(issue: IssueSummary | null) {
    setLogIssue(issue);
    setLogOrigin(issue ? tab : null);
    setLogVisit((v) => v + 1);
    setTab("log");
  }

  function onLogged() {
    setRefreshKey((k) => k + 1);
    // A fresh worklog may resolve a reminder — recheck right away.
    refreshMissing("post-log");
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
          <button
            className="link"
            title="Open the user manual on GitHub"
            onClick={() => openUrl(HANDBOOK_URL)}
          >
            Handbook
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

      <WhatsNew
        onOpenSettings={() => {
          setSettingsTab("todo");
          setEditingCreds(true);
        }}
      />

      <UpdateNotice />

      <TimerBar onLogged={onLogged} />

      <nav className="tabs">
        <button
          className={tab === "start" ? "active" : ""}
          onClick={() => setTab("start")}
        >
          Start
        </button>
        <button
          className={tab === "todo" ? "active" : ""}
          onClick={() => setTab("todo")}
        >
          Todo
        </button>
        <button
          className={tab === "log" ? "active" : ""}
          // A manual visit starts fresh, without a preselected issue — also
          // when the tab is already open.
          onClick={() => openLogTab(null)}
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
        <button
          className={`${tab === "mentions" ? "active" : ""}${
            mentionsUnread > 0 ? " alert" : ""
          }`}
          onClick={() => setTab("mentions")}
        >
          Mentions
          {mentionsUnread > 0 && ` · ${mentionsUnread}`}
        </button>
      </nav>

      <main>
        {tab === "start" && (
          <Start
            site={creds.site}
            refreshKey={refreshKey}
            onSelectIssue={openLogTab}
            onOpenMissing={() => setTab("missing")}
            onLogged={onLogged}
          />
        )}
        {tab === "todo" && (
          <Todo site={creds.site} onSelectIssue={openLogTab} />
        )}
        {tab === "log" && (
          <LogWork
            key={logVisit}
            site={creds.site}
            onLogged={onLogged}
            initialIssue={logIssue}
            backLabel={logOrigin ? TAB_LABELS[logOrigin] : undefined}
            onBack={logOrigin ? () => setTab(logOrigin) : undefined}
          />
        )}
        {tab === "timesheet" && (
          <Timesheet site={creds.site} refreshKey={refreshKey} />
        )}
        {tab === "missing" && (
          <MissingWorklogs site={creds.site} onLogged={onLogged} />
        )}
        {tab === "mentions" && (
          <Mentions site={creds.site} onLogWork={openLogTab} />
        )}
      </main>
    </div>
  );
}
