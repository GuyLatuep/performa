import type { CredentialsMeta } from "./api";

/**
 * Moving performa to another computer: the user's settings, written out to a
 * file on one machine and read back in on the next.
 *
 * Each setting travels as the exact text it is stored under — some are bare
 * strings, some JSON — so neither side needs to know any setting's shape. The
 * store modules read their keys once at start-up and vet whatever they find,
 * which is why an import ends in a restart: a value that does not parse is
 * answered there, by falling back to that setting's default, the same as any
 * other unreadable stored value.
 *
 * The Jira credentials never go into the file. They live in the OS keychain,
 * and a file people email to themselves is not a place for an API token — the
 * user signs in on the new machine, then imports.
 */

/**
 * The settings that travel. Everything else stays with the machine:
 *
 * - the log level, a per-machine diagnostic;
 * - the issue type icon cache, which refills itself;
 * - the old single daily-hours value, read once to seed the per-weekday hours;
 * - the running timer and the stopped ones waiting for their log form;
 * - which Mentions and Missing worklogs were seen, notified or ignored, which
 *   notices were shown and which update was dismissed;
 * - the owner markers, which the import sets for the account it lands in.
 */
export const TRANSFERRED_KEYS: readonly string[] = [
  // Preferences
  "performa-theme",
  "performa-accent",
  "performa-text-scale",
  "performa-show-weekends",
  "performa-fun-mode",
  "performa-show-issue-type-icons",
  "performa-timesheet-view",
  "performa-month-sort",
  "performa-idle-minutes",
  "performa-weekday-hours",
  "performa-holiday-state",
  "performa-todo-sort",
  // The user's own content
  "performa-worklog-templates",
  "performa-pinned-issues",
  "performa-absences",
  "performa-drafts",
  "performa-achievements",
  // Written in the terms of one Jira site
  "performa-saved-searches",
  "performa-issue-fields",
  "performa-todo-ignored-statuses",
];

/** The keys whose values name one site's fields, projects or statuses. */
export const SITE_SPECIFIC_KEYS: readonly string[] = [
  "performa-saved-searches",
  "performa-issue-fields",
  "performa-todo-ignored-statuses",
];

const DRAFTS_KEY = "performa-drafts";
const SAVED_SEARCHES_KEY = "performa-saved-searches";
/** Kept in step with the owner key in `savedSearches.ts`. */
const SAVED_SEARCHES_OWNER_KEY = "performa-saved-searches-owner";

const APP = "performa";
/** Raised when the file's shape changes in a way an older app would misread. */
export const FORMAT = 1;

interface SettingsFile {
  app: typeof APP;
  format: number;
  exportedAt: string;
  appVersion: string;
  account: CredentialsMeta;
  settings: Record<string, string>;
}

/** The suggested name for an export made on `now`'s local date. */
export function settingsFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `performa-settings-${date}.json`;
}

/** The export file's text: every transferred setting that has a stored value. */
export function exportSettings(
  appVersion: string,
  account: CredentialsMeta,
  now: Date = new Date(),
): string {
  const settings: Record<string, string> = {};
  for (const key of TRANSFERRED_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  const file: SettingsFile = {
    app: APP,
    format: FORMAT,
    exportedAt: now.toISOString(),
    appVersion,
    account: { site: account.site, email: account.email },
    settings,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/** What a picked file turned out to be. */
export type ImportCheck =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The transferred settings in the file, ready to write. */
      settings: Record<string, string>;
      /** Exported from another account than the one signed in, or from an
       *  unknown one: site-specific settings may not fit this site. */
      otherAccount: boolean;
      /** The file carries Draft worklogs, which stay on the old computer too. */
      hasDrafts: boolean;
    };

const NOT_A_SETTINGS_FILE = "This is not a performa settings file.";

/** Check a picked file before anything is written. Nothing here touches
 *  storage — a file that is turned away leaves every setting as it was. */
export function checkImport(
  text: string,
  account: CredentialsMeta,
): ImportCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: NOT_A_SETTINGS_FILE };
  }
  if (!isRecord(parsed) || parsed.app !== APP || !isRecord(parsed.settings)) {
    return { ok: false, reason: NOT_A_SETTINGS_FILE };
  }
  if (typeof parsed.format !== "number" || !Number.isInteger(parsed.format)) {
    return { ok: false, reason: NOT_A_SETTINGS_FILE };
  }
  if (parsed.format > FORMAT) {
    return {
      ok: false,
      reason:
        "This file was saved by a newer version of performa. Update performa, then import it again.",
    };
  }

  // Unknown keys are skipped rather than refused: a file from a newer app
  // carries settings this one has never heard of, and the rest still fit.
  // Excluded keys are skipped the same way, so a hand-edited file cannot reach
  // the running timer or the seen markers.
  const settings: Record<string, string> = {};
  for (const key of TRANSFERRED_KEYS) {
    const value = parsed.settings[key];
    if (typeof value === "string") settings[key] = value;
  }

  return {
    ok: true,
    settings,
    otherAccount: !sameAccount(parsed.account, account),
    hasDrafts: DRAFTS_KEY in settings,
  };
}

/**
 * Write a checked file's settings, replacing what is stored under each of
 * them. Settings the file does not carry are left alone.
 *
 * Saved searches belong to an account, and the account check drops any that
 * were written for somebody else. Imported ones are the user's choice for the
 * account they are signed in as now, so they are claimed for it here — or the
 * restart would throw them away again.
 *
 * The caller restarts the app afterwards: the stores read storage once, at
 * start-up.
 */
export function applyImport(
  settings: Record<string, string>,
  account: CredentialsMeta,
): void {
  for (const [key, value] of Object.entries(settings)) {
    if (TRANSFERRED_KEYS.includes(key)) localStorage.setItem(key, value);
  }
  if (SAVED_SEARCHES_KEY in settings) {
    localStorage.setItem(
      SAVED_SEARCHES_OWNER_KEY,
      `${account.site}|${account.email}`,
    );
  }
}

function sameAccount(stored: unknown, current: CredentialsMeta): boolean {
  if (!isRecord(stored)) return false;
  const { site, email } = stored;
  if (typeof site !== "string" || typeof email !== "string") return false;
  return (
    normalSite(site) === normalSite(current.site) &&
    email.trim().toLowerCase() === current.email.trim().toLowerCase()
  );
}

/** `https://acme.atlassian.net/` and `https://ACME.atlassian.net` are one site. */
function normalSite(site: string): string {
  return site.trim().toLowerCase().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
