/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

const plugins = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugins.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugins.relaunch }));
vi.mock("../log", () => ({ logDebug: vi.fn() }));

import { checkForUpdates, resetUpdateState } from "../updates";
import SettingsUpdates from "./SettingsUpdates";

const checkButton = () =>
  screen.getByRole("button", { name: "Check for updates" });
const status = () => screen.getByRole("status").textContent;

function update(version = "0.5.0") {
  return {
    version,
    currentVersion: "0.4.0",
    downloadAndInstall: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetUpdateState();
  plugins.check.mockResolvedValue(null);
});

describe("before anything is asked", () => {
  it("says the app checks by itself every hour", () => {
    render(<SettingsUpdates />);

    expect(status()).toContain("every hour");
  });

  it("offers no install", () => {
    render(<SettingsUpdates />);

    expect(
      screen.queryByRole("button", { name: "Update & restart" }),
    ).toBeNull();
  });
});

describe("checking now", () => {
  it("says it is checking, and cannot be pressed twice meanwhile", async () => {
    plugins.check.mockReturnValue(new Promise(() => {}));
    render(<SettingsUpdates />);

    await userEvent.click(checkButton());

    expect(status()).toBe("Checking…");
    expect(checkButton()).toHaveProperty("disabled", true);
  });

  it("says the app is up to date when it is", async () => {
    render(<SettingsUpdates />);

    await userEvent.click(checkButton());

    expect(status()).toContain("latest version");
    expect(checkButton()).toHaveProperty("disabled", false);
  });

  it("names the newer version and offers to install it", async () => {
    plugins.check.mockResolvedValue(update("0.5.0"));
    render(<SettingsUpdates />);

    await userEvent.click(checkButton());

    expect(status()).toContain("Version 0.5.0 is available");
    expect(
      screen.getByRole("button", { name: "Update & restart" }),
    ).toBeDefined();
  });

  it("installs from here and restarts", async () => {
    const found = update("0.5.0");
    plugins.check.mockResolvedValue(found);
    render(<SettingsUpdates />);
    await userEvent.click(checkButton());

    await userEvent.click(
      screen.getByRole("button", { name: "Update & restart" }),
    );

    expect(found.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(plugins.relaunch).toHaveBeenCalledTimes(1);
  });

  it("says why when the check fails, and can be tried again", async () => {
    plugins.check.mockRejectedValueOnce(new Error("no network"));
    render(<SettingsUpdates />);

    await userEvent.click(checkButton());

    expect(
      screen.getByText(/Couldn’t check for updates: .*no network/),
    ).toBeDefined();
    expect(checkButton()).toHaveProperty("disabled", false);

    await userEvent.click(checkButton());
    expect(status()).toContain("latest version");
  });

  it("shows what a check in the background found, too", async () => {
    // One store behind both: an hourly result reaches this screen as well.
    render(<SettingsUpdates />);
    plugins.check.mockResolvedValue(update("0.6.0"));

    await act(async () => {
      await checkForUpdates();
    });

    expect(status()).toContain("Version 0.6.0 is available");
  });
});
