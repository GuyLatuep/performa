import { beforeEach, describe, expect, it } from "vitest";
import {
  applyImport,
  checkImport,
  exportSettings,
  FORMAT,
  settingsFileName,
  TRANSFERRED_KEYS,
} from "./settingsTransfer";

const ME = { site: "https://acme.atlassian.net", email: "anna@acme.example" };

/** A file as `exportSettings` writes it, with `settings` and any override. */
function file(
  settings: Record<string, unknown>,
  o: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    app: "performa",
    format: FORMAT,
    exportedAt: "2026-10-19T08:00:00.000Z",
    appVersion: "2.6.2",
    account: ME,
    settings,
    ...o,
  });
}

/** Everything in storage, for comparing before and after. */
function stored(): Record<string, string> {
  const all: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    all[key] = localStorage.getItem(key)!;
  }
  return all;
}

beforeEach(() => {
  localStorage.clear();
});

describe("the file name", () => {
  it("carries the local date", () => {
    expect(settingsFileName(new Date(2026, 0, 5, 23, 30))).toBe(
      "performa-settings-2026-01-05.json",
    );
  });
});

describe("exporting", () => {
  it("carries each transferred setting as the exact text it is stored as", () => {
    localStorage.setItem("performa-theme", "dark");
    localStorage.setItem("performa-pinned-issues", '[{"key":"ABC-1"}]');

    const parsed = JSON.parse(exportSettings("2.6.2", ME));

    expect(parsed.settings).toEqual({
      "performa-theme": "dark",
      "performa-pinned-issues": '[{"key":"ABC-1"}]',
    });
  });

  it("says what made it and for whom", () => {
    const parsed = JSON.parse(
      exportSettings("2.6.2", ME, new Date("2026-10-19T08:00:00Z")),
    );

    expect(parsed).toMatchObject({
      app: "performa",
      format: FORMAT,
      appVersion: "2.6.2",
      exportedAt: "2026-10-19T08:00:00.000Z",
      account: ME,
    });
  });

  it("leaves out what belongs to this machine, and never the login", () => {
    for (const key of [
      "performa-active-timer",
      "performa-timers-to-log",
      "performa-log-level",
      "performa-issue-type-icons",
      "performa-daily-hours",
      "performa-mentions-read",
      "performa-missing-seen",
      "performa-notices-seen",
      "performa-update-dismissed",
      "performa-saved-searches-owner",
    ]) {
      localStorage.setItem(key, "x");
    }

    const text = exportSettings("2.6.2", ME);

    expect(JSON.parse(text).settings).toEqual({});
    expect(text).not.toMatch(/token/i);
  });
});

describe("checking a file", () => {
  it.each([
    ["not JSON", "{oops"],
    ["JSON of something else", '{"name":"package"}'],
    ["a list", "[]"],
    ["no settings", JSON.stringify({ app: "performa", format: 1 })],
    ["no format", file({}, { format: undefined })],
  ])("turns away %s", (_, text) => {
    const check = checkImport(text, ME);

    expect(check).toEqual({
      ok: false,
      reason: "This is not a performa settings file.",
    });
  });

  it("turns away a file from a newer format, asking for an update", () => {
    const check = checkImport(file({}, { format: FORMAT + 1 }), ME);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/newer version/);
  });

  it("keeps only the transferred settings with text values", () => {
    const check = checkImport(
      file({
        "performa-theme": "dark",
        "performa-active-timer": "{}",
        "performa-from-the-future": "1",
        "performa-accent": 42,
      }),
      ME,
    );

    expect(check).toMatchObject({
      ok: true,
      settings: { "performa-theme": "dark" },
    });
  });

  it("writes nothing", () => {
    localStorage.setItem("performa-theme", "light");

    checkImport(file({ "performa-theme": "dark" }), ME);

    expect(stored()).toEqual({ "performa-theme": "light" });
  });

  it("notices Draft worklogs in the file", () => {
    expect(checkImport(file({ "performa-drafts": "[]" }), ME)).toMatchObject({
      hasDrafts: true,
    });
    expect(checkImport(file({}), ME)).toMatchObject({ hasDrafts: false });
  });
});

describe("which account a file came from", () => {
  it("is the same one despite case and a trailing slash", () => {
    const check = checkImport(
      file(
        {},
        {
          account: {
            site: "https://ACME.atlassian.net/",
            email: "Anna@Acme.example",
          },
        },
      ),
      ME,
    );

    expect(check).toMatchObject({ ok: true, otherAccount: false });
  });

  it.each([
    ["another site", { ...ME, site: "https://other.atlassian.net" }],
    ["another email", { ...ME, email: "bob@acme.example" }],
    ["unknown", undefined],
  ])("is flagged when it is %s", (_, account) => {
    expect(checkImport(file({}, { account }), ME)).toMatchObject({
      ok: true,
      otherAccount: true,
    });
  });
});

describe("importing", () => {
  it("replaces what the file carries and leaves the rest alone", () => {
    localStorage.setItem("performa-theme", "light");
    localStorage.setItem("performa-accent", "#007aff");
    localStorage.setItem("performa-active-timer", '{"issueKey":"ABC-1"}');

    applyImport({ "performa-theme": "dark" }, ME);

    expect(stored()).toEqual({
      "performa-theme": "dark",
      "performa-accent": "#007aff",
      "performa-active-timer": '{"issueKey":"ABC-1"}',
    });
  });

  it("cannot reach a setting outside the list", () => {
    applyImport({ "performa-active-timer": "{}" }, ME);

    expect(stored()).toEqual({});
  });

  // Otherwise the account check at start-up would see searches owned by
  // somebody else and drop them.
  it("claims imported saved searches for the account signed in now", () => {
    localStorage.setItem("performa-saved-searches-owner", "old|someone");

    applyImport({ "performa-saved-searches": "[]" }, ME);

    expect(localStorage.getItem("performa-saved-searches-owner")).toBe(
      `${ME.site}|${ME.email}`,
    );
  });

  it("leaves the owner alone when no saved searches come in", () => {
    localStorage.setItem("performa-saved-searches-owner", "old|someone");

    applyImport({ "performa-theme": "dark" }, ME);

    expect(localStorage.getItem("performa-saved-searches-owner")).toBe(
      "old|someone",
    );
  });
});

describe("the round trip", () => {
  it("brings back every transferred setting exactly", () => {
    const before: Record<string, string> = {};
    for (const key of TRANSFERRED_KEYS) {
      before[key] = `${key}-value`;
      localStorage.setItem(key, before[key]);
    }
    const text = exportSettings("2.6.2", ME);
    localStorage.clear();

    const check = checkImport(text, ME);
    if (!check.ok) throw new Error(check.reason);
    applyImport(check.settings, ME);

    for (const key of TRANSFERRED_KEYS) {
      expect(localStorage.getItem(key)).toBe(before[key]);
    }
    expect(check.otherAccount).toBe(false);
  });
});
