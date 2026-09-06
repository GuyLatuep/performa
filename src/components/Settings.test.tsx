/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { CredentialsMeta } from "../api";
import Settings from "./Settings";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.0" }));

// The settings screen owns what spans its tabs — which one is open, and the
// rollback of the live-previewed stores. The tabs themselves have their own
// tests, so they are stubbed down to a marker each.
vi.mock("./SettingsAppearance", () => ({
  default: () => <div>appearance tab</div>,
}));
vi.mock("./SettingsTimesheet", () => ({
  default: () => <div>timesheet tab</div>,
}));
vi.mock("./SettingsTodo", () => ({ default: () => <div>todo tab</div> }));
vi.mock("./SettingsLogging", () => ({ default: () => <div>logging tab</div> }));
vi.mock("./SettingsFun", () => ({ default: () => <div>fun tab</div> }));
vi.mock("./SettingsConnection", () => ({
  default: ({ onCancel }: { onCancel?: () => void }) => (
    <div>
      connection tab
      {onCancel && (
        <button onClick={onCancel} type="button">
          connection cancel
        </button>
      )}
    </div>
  ),
}));

// The live-preview stores. Cancel has to put every one of them back, so each
// is stubbed with a getter the test seeds and a setter it can watch.
const stores = vi.hoisted(() => ({
  /** What the theme store currently holds. Mutable so a test can act out a
   *  live preview: the user changes the theme while the screen is open. */
  theme: "dark",
  setTheme: vi.fn(),
  setAccent: vi.fn(),
  setTextScale: vi.fn(),
  setDailyHours: vi.fn(),
  setShowWeekends: vi.fn(),
  setShowIssueTypeIcons: vi.fn(),
  setLogLevel: vi.fn(),
  setIgnoredStatuses: vi.fn(),
}));
vi.mock("../theme", () => ({
  getTheme: () => stores.theme,
  setTheme: stores.setTheme,
}));
vi.mock("../accent", () => ({
  getAccent: () => "amber",
  setAccent: stores.setAccent,
}));
vi.mock("../textScale", () => ({
  getTextScale: () => "large",
  setTextScale: stores.setTextScale,
}));
vi.mock("../todoStatuses", () => ({
  getIgnoredStatuses: () => ["Done"],
  setIgnoredStatuses: stores.setIgnoredStatuses,
}));
vi.mock("../settings", () => ({
  getDailyHours: () => 7,
  getShowWeekends: () => true,
  getShowIssueTypeIcons: () => false,
  getLogLevel: () => "debug",
  setDailyHours: stores.setDailyHours,
  setShowWeekends: stores.setShowWeekends,
  setShowIssueTypeIcons: stores.setShowIssueTypeIcons,
  setLogLevel: stores.setLogLevel,
}));

const existing = { site: "team.atlassian.net" } as CredentialsMeta;

async function renderSettings(
  props: Partial<Parameters<typeof Settings>[0]> = {},
) {
  const onSaved = vi.fn();
  const view = render(
    <Settings existing={null} onSaved={onSaved} {...props} />,
  );
  // The version arrives through a promise.
  await act(async () => {});
  return { onSaved, ...view };
}

const tab = (name: string) => screen.getByRole("tab", { name });

beforeEach(() => {
  vi.clearAllMocks();
  stores.theme = "dark";
});

describe("which tab opens", () => {
  it("starts on the connection on first run", async () => {
    // Nothing else in the app matters until it is set up.
    await renderSettings({ existing: null });

    expect(screen.getByText("connection tab")).toBeDefined();
    expect(tab("General").getAttribute("aria-selected")).toBe("true");
  });

  it("starts on appearance once connected", async () => {
    // The more common reason to reopen the screen.
    await renderSettings({ existing, onCancel: vi.fn() });

    expect(screen.getByText("appearance tab")).toBeDefined();
    expect(tab("Appearance").getAttribute("aria-selected")).toBe("true");
  });

  it("starts where the caller asks", async () => {
    // The todo-filter notice sends people straight to the filter.
    await renderSettings({ existing, initialTab: "todo", onCancel: vi.fn() });

    expect(screen.getByText("todo tab")).toBeDefined();
  });

  it("opens the asked-for tab even on first run", async () => {
    await renderSettings({ existing: null, initialTab: "logging" });

    expect(screen.getByText("logging tab")).toBeDefined();
  });
});

describe("moving between tabs", () => {
  it("shows one tab at a time", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    await userEvent.click(tab("Timesheet"));

    expect(screen.getByText("timesheet tab")).toBeDefined();
    expect(screen.queryByText("appearance tab")).toBeNull();
  });

  it("marks the open one as selected", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    await userEvent.click(tab("Logging"));

    expect(tab("Logging").getAttribute("aria-selected")).toBe("true");
    expect(tab("Appearance").getAttribute("aria-selected")).toBe("false");
  });

  it("keeps the fun settings with the connection", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    await userEvent.click(tab("General"));

    expect(screen.getByText("connection tab")).toBeDefined();
    expect(screen.getByText("fun tab")).toBeDefined();
  });

  it("reaches every tab in the bar", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    for (const [label, marker] of [
      ["General", "connection tab"],
      ["Appearance", "appearance tab"],
      ["Timesheet", "timesheet tab"],
      ["Todo", "todo tab"],
      ["Logging", "logging tab"],
    ]) {
      await userEvent.click(tab(label));
      expect(screen.getByText(marker)).toBeDefined();
    }
  });
});

describe("save and cancel", () => {
  it("gives the connection tab no buttons of its own", async () => {
    // Its Save has to submit the form, so it brings its own pair.
    await renderSettings({
      existing,
      initialTab: "connection",
      onCancel: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("offers them on the other tabs", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("offers neither on first run", async () => {
    // Nowhere to go back to.
    await renderSettings({ existing: null, initialTab: "appearance" });

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("just closes on Save — the stores are already live", async () => {
    const onCancel = vi.fn();
    await renderSettings({ existing, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(stores.setTheme).not.toHaveBeenCalled();
    expect(stores.setAccent).not.toHaveBeenCalled();
  });

  it("puts every previewed setting back on Cancel", async () => {
    // They apply instantly as they are changed, so leaving without saving has
    // to undo them by hand — a snapshot from when the screen opened.
    const onCancel = vi.fn();
    await renderSettings({ existing, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(stores.setTheme).toHaveBeenCalledWith("dark");
    expect(stores.setAccent).toHaveBeenCalledWith("amber");
    expect(stores.setTextScale).toHaveBeenCalledWith("large");
    expect(stores.setDailyHours).toHaveBeenCalledWith(7);
    expect(stores.setShowWeekends).toHaveBeenCalledWith(true);
    expect(stores.setShowIssueTypeIcons).toHaveBeenCalledWith(false);
    expect(stores.setLogLevel).toHaveBeenCalledWith("debug");
    expect(stores.setIgnoredStatuses).toHaveBeenCalledWith(["Done"]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("rolls back from the connection tab's own Cancel too", async () => {
    const onCancel = vi.fn();
    await renderSettings({ existing, initialTab: "connection", onCancel });

    await userEvent.click(
      screen.getByRole("button", { name: "connection cancel" }),
    );

    expect(stores.setTheme).toHaveBeenCalledWith("dark");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("gives the connection tab no cancel on first run", async () => {
    await renderSettings({ existing: null, initialTab: "connection" });

    expect(
      screen.queryByRole("button", { name: "connection cancel" }),
    ).toBeNull();
  });

  it("keeps the snapshot from when it opened, not from the last render", async () => {
    // The whole point of the ref: a theme picked on Appearance is live in the
    // store immediately, so anything that re-snapshots would capture the new
    // value and "roll back" to the very change being abandoned.
    const onCancel = vi.fn();
    await renderSettings({ existing, onCancel });

    // The user picks a new theme; it applies instantly.
    stores.theme = "light";
    await userEvent.click(tab("Logging"));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(stores.setTheme).toHaveBeenCalledWith("dark");
    expect(stores.setTheme).not.toHaveBeenCalledWith("light");
  });
});

describe("the build stamp", () => {
  it("shows the running version and when it was built", async () => {
    await renderSettings({ existing, onCancel: vi.fn() });

    expect(
      screen.getByText(/v0\.4\.0 · built 2026-01-01 00:00 UTC/),
    ).toBeDefined();
  });
});
