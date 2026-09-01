import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { CredentialsMeta } from "../api";
import {
  getDailyHours,
  getLogLevel,
  getShowIssueTypeIcons,
  getShowWeekends,
  setDailyHours,
  setLogLevel,
  setShowIssueTypeIcons,
  setShowWeekends,
} from "../settings";
import { getTheme, setTheme } from "../theme";
import { getIgnoredStatuses, setIgnoredStatuses } from "../todoStatuses";
import { getAccent, setAccent } from "../accent";
import { getTextScale, setTextScale } from "../textScale";
import Blockmark from "./Blockmark";
import SettingsConnection from "./SettingsConnection";
import SettingsFun from "./SettingsFun";
import SettingsAppearance from "./SettingsAppearance";
import SettingsTimesheet from "./SettingsTimesheet";
import SettingsTodo from "./SettingsTodo";
import SettingsLogging from "./SettingsLogging";

interface Props {
  existing: CredentialsMeta | null;
  onSaved: () => void;
  onCancel?: () => void;
  /** Tab to open on, when the caller has a reason to send the user somewhere
   *  specific (the todo-filter notice does). */
  initialTab?: SettingsTab;
}

type SettingsTab =
  "connection" | "appearance" | "timesheet" | "todo" | "logging";

const TABS: { id: SettingsTab; label: string }[] = [
  // The tab is more than the connection now — it holds whatever is about the
  // app itself rather than one of its views. The id stays put: it is a stored
  // value and renaming it would drop everyone on a tab they did not pick.
  { id: "connection", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "timesheet", label: "Timesheet" },
  { id: "todo", label: "Todo" },
  { id: "logging", label: "Logging" },
];

/** First-run connect screen; doubles as the settings page once signed in.
 *  Holds what spans the tabs — which one is open, and the rollback of the
 *  live-previewed settings — while each tab owns its own fields. */
export default function Settings({
  existing,
  onSaved,
  onCancel,
  initialTab,
}: Props) {
  const [version, setVersion] = useState("");
  // Editing an existing connection lands on Appearance — that's the more
  // common reason to reopen this screen. First run has to start on
  // Connection since nothing else matters until it's set up.
  const [tab, setTab] = useState<SettingsTab>(
    initialTab ?? (existing ? "appearance" : "connection"),
  );

  // Theme, accent, text size, hours, weekend toggle, type icons and log level
  // apply instantly (live preview), so keep a snapshot from when the screen
  // opened and restore it on Cancel.
  const snapshot = useRef({
    theme: getTheme(),
    accent: getAccent(),
    textScale: getTextScale(),
    hours: getDailyHours(),
    weekends: getShowWeekends(),
    typeIcons: getShowIssueTypeIcons(),
    logLevel: getLogLevel(),
    ignoredStatuses: getIgnoredStatuses(),
  });

  function cancel() {
    setTheme(snapshot.current.theme);
    setAccent(snapshot.current.accent);
    setTextScale(snapshot.current.textScale);
    setDailyHours(snapshot.current.hours);
    setShowWeekends(snapshot.current.weekends);
    setShowIssueTypeIcons(snapshot.current.typeIcons);
    setLogLevel(snapshot.current.logLevel);
    setIgnoredStatuses(snapshot.current.ignoredStatuses);
    onCancel?.();
  }

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <div className={`setup${onCancel ? " settings-page" : ""}`}>
      <div className="setup-mark">
        <Blockmark />
      </div>
      <span className="eyebrow">Time ledger · Jira</span>
      <h1>performa</h1>

      <div className="settings-tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "connection" && (
        <>
          <SettingsConnection
            existing={existing}
            onSaved={onSaved}
            onCancel={onCancel ? cancel : undefined}
          />
          <SettingsFun />
        </>
      )}
      {tab === "appearance" && <SettingsAppearance />}
      {tab === "timesheet" && <SettingsTimesheet />}
      {tab === "todo" && <SettingsTodo />}
      {tab === "logging" && <SettingsLogging />}

      {/* The connection tab brings its own buttons — its Save has to submit
          the form. */}
      {tab !== "connection" && onCancel && (
        <div className="row">
          <button type="button" className="secondary" onClick={cancel}>
            Cancel
          </button>
          {/* Theme/accent/hours/weekends/icons/log level are already live in the
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
