import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AtSign,
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api, CredentialsMeta, IssueSummary } from "./api";
import { logInfo } from "./log";
import Settings from "./components/Settings";
import Start from "./components/Start";
import Todo from "./components/Todo";
import LogWork from "./components/LogWork";
import Timesheet from "./components/Timesheet";
import TimerBar from "./components/TimerBar";
import MissingWorklogs from "./components/MissingWorklogs";
import { playCheer, playFanfare } from "./fun";
import {
  getAchievementState,
  isMilestoneLog,
  recordEvent,
} from "./achievements";
import { onWorklogFiled } from "./worklogEvents";
import AchievementToast from "./components/AchievementToast";
import { useFunMode } from "./settings";
import About from "./components/About";
import Confetti from "./components/Confetti";
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

/* Lucide rather than SF Symbols, which are licensed for Apple's own platforms
   and may not be redrawn or shipped here. Lucide sits closest to them in
   weight and geometry. */
const TAB_ICONS: Record<Tab, LucideIcon> = {
  start: LayoutDashboard,
  todo: ListChecks,
  log: Timer,
  timesheet: CalendarRange,
  missing: TriangleAlert,
  mentions: AtSign,
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
  /** Bumped to fire a burst of confetti, with the size it should be. */
  const [confetti, setConfetti] = useState(0);
  const [confettiPieces, setConfettiPieces] = useState(0);
  /** Titles earned but not yet shown. */
  const [awards, setAwards] = useState<string[]>([]);
  // Counts entries into the log tab. Used as LogWork's key so every visit
  // remounts it: the component keeps the picked issue in its own state, which
  // a changed `initialIssue` alone would not clear — least of all when it
  // changes from "no issue" to "no issue" (see `openLogTab`).
  const [logVisit, setLogVisit] = useState(0);
  // Tab the log form was opened from, so it can offer a way straight back
  // there. Null for a manual visit to the log tab — there is nowhere to return.
  const [logOrigin, setLogOrigin] = useState<Tab | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const missingItems = useMissing();
  const missingUnseen = useMissingUnseenCount();
  const mentionsUnread = useMentionsUnreadCount();
  const funMode = useFunMode();

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
  // Keyed on the account rather than on `signedIn`: read and notified state
  // belongs to whoever's inbox it was collected from.
  const mentionsAccount = creds ? `${creds.site}|${creds.email}` : null;
  useEffect(() => {
    if (!mentionsAccount) return;
    startMentionsPolling(mentionsAccount);
    return stopMentionsPolling;
  }, [mentionsAccount]);

  // A single choke point for "which view is the user in" — covers every way
  // a tab can change (nav click, start-tab shortcuts) without instrumenting
  // each one individually.
  useEffect(() => {
    if (signedIn) logInfo(`view: ${tab}`);
  }, [signedIn, tab]);

  // The celebrating, kept apart from the refreshing: this one needs to know
  // what was logged, which `api.logWork` announces.
  useEffect(
    () =>
      onWorklogFiled((worklog) => {
        if (!funMode) return;
        const earned = recordEvent({
          kind: "logged",
          date: worklog.date,
          time: worklog.time,
        });
        // Rarer and louder every tenth time, counted after this one landed.
        if (isMilestoneLog(getAchievementState().loggedCount)) playFanfare();
        else playCheer();
        setConfettiPieces(confettiFor(worklog.timeSpentSeconds));
        setConfetti((c) => c + 1);
        if (earned.length > 0) setAwards(earned);
      }),
    [funMode],
  );

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

  if (showAbout) {
    return <About onClose={() => setShowAbout(false)} />;
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

  /** One row of the source list. `count`, when there is one, rides in the
   *  accessible name as well as the badge — a screen reader gets "Mentions ·
   *  2" the way the eye does. */
  function navRow(t: Tab, count: number, alert: boolean, onSelect: () => void) {
    const Icon = TAB_ICONS[t];
    const label = TAB_LABELS[t];
    return (
      <button
        className={`nav-row${tab === t ? " active" : ""}${alert ? " alert" : ""}`}
        aria-label={count > 0 ? `${label} · ${count}` : label}
        aria-current={tab === t ? "page" : undefined}
        onClick={onSelect}
      >
        <Icon className="nav-icon" size={18} strokeWidth={1.75} aria-hidden />
        <span className="nav-label">{label}</span>
        {count > 0 && <span className="nav-count">{count}</span>}
      </button>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Blockmark />
          performa
        </div>

        <nav className="nav">
          {navRow("start", 0, false, () => setTab("start"))}
          {navRow("todo", 0, false, () => setTab("todo"))}
          {/* A manual visit starts fresh, without a preselected issue — also
              when the tab is already open. */}
          {navRow("log", 0, false, () => openLogTab(null))}
          {navRow("timesheet", 0, false, () => setTab("timesheet"))}
          {navRow("missing", missingItems.length, missingUnseen > 0, () =>
            setTab("missing"),
          )}
          {navRow("mentions", mentionsUnread, mentionsUnread > 0, () =>
            setTab("mentions"),
          )}
        </nav>

        <div className="account">
          <span className="muted">{creds.email}</span>
          <div className="account-actions">
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
            <button className="link" onClick={() => setShowAbout(true)}>
              About
            </button>
            {confirmSignOut ? (
              <>
                <span className="confirm-text">Sign out?</span>
                <button className="link" onClick={doSignOut}>
                  Yes
                </button>
                <button
                  className="link"
                  onClick={() => setConfirmSignOut(false)}
                >
                  No
                </button>
              </>
            ) : (
              <button className="link" onClick={() => setConfirmSignOut(true)}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="content">
        <header>
          <h1>{TAB_LABELS[tab]}</h1>
        </header>

        <WhatsNew
          onOpenSettings={() => {
            setSettingsTab("todo");
            setEditingCreds(true);
          }}
        />

        <UpdateNotice />

        <Confetti trigger={confetti} pieces={confettiPieces} />
        <AchievementToast queue={awards} />
        <TimerBar onLogged={onLogged} />

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
          {tab === "todo" && <Todo site={creds.site} onLogged={onLogged} />}
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
            <Mentions site={creds.site} onLogged={onLogged} />
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * How much confetti a worklog is worth.
 *
 * A quarter of an hour gets a handful and a full day gets the cannon, on a
 * curve rather than a straight line — the difference between fifteen minutes
 * and an hour should be visible, and the difference between seven hours and
 * eight need not be.
 */
function confettiFor(seconds: number): number {
  const hours = Math.max(0, seconds) / 3600;
  return Math.round(20 + 130 * Math.min(1, Math.sqrt(hours / 8)));
}
