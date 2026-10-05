/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The updater plugin does not exist under vitest. What is under test is what
// the store makes of its answers.
const plugins = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugins.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugins.relaunch }));
vi.mock("./log", () => ({ logDebug: vi.fn() }));

import {
  checkForUpdates,
  CHECK_MS,
  DISMISSED_KEY,
  getUpdateState,
  installUpdate,
  resetUpdateState,
  startUpdateChecks,
} from "./updates";

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

describe("a check", () => {
  it("says the app is current when nothing newer exists", async () => {
    await checkForUpdates();

    expect(getUpdateState().kind).toBe("current");
  });

  it("offers a newer release when there is one", async () => {
    plugins.check.mockResolvedValue(update("0.5.0"));

    await checkForUpdates();

    const state = getUpdateState();
    expect(state.kind === "available" && state.update.version).toBe("0.5.0");
  });

  it("joins one already running rather than asking twice", async () => {
    await Promise.all([checkForUpdates(), checkForUpdates({ manual: true })]);

    expect(plugins.check).toHaveBeenCalledTimes(1);
  });

  it("leaves an install alone", async () => {
    plugins.check.mockResolvedValue({
      ...update(),
      downloadAndInstall: vi.fn(() => new Promise<undefined>(() => {})),
    });
    await checkForUpdates();
    void installUpdate();
    plugins.check.mockClear();

    await checkForUpdates({ manual: true });

    expect(plugins.check).not.toHaveBeenCalled();
    expect(getUpdateState().kind).toBe("installing");
  });
});

describe("a check in the background", () => {
  it("shows nothing while it runs", async () => {
    const pending = checkForUpdates();

    expect(getUpdateState().kind).toBe("idle");
    await pending;
  });

  it("keeps what was known when it fails", async () => {
    // A GitHub outage must not take an offered update away, or show an error
    // to somebody who never asked.
    plugins.check.mockResolvedValue(update("0.5.0"));
    await checkForUpdates();
    plugins.check.mockRejectedValue(new Error("no network"));

    await checkForUpdates();

    expect(getUpdateState().kind).toBe("available");
  });

  it("leaves a dismissal standing", async () => {
    localStorage.setItem(DISMISSED_KEY, "0.5.0");
    plugins.check.mockResolvedValue(update("0.5.0"));

    await checkForUpdates();

    expect(localStorage.getItem(DISMISSED_KEY)).toBe("0.5.0");
  });
});

describe("a check somebody asked for", () => {
  it("says it is checking while it runs", async () => {
    const pending = checkForUpdates({ manual: true });

    expect(getUpdateState().kind).toBe("checking");
    await pending;
  });

  it("says why when it fails", async () => {
    plugins.check.mockRejectedValue(new Error("no network"));

    await checkForUpdates({ manual: true });

    const state = getUpdateState();
    expect(state.kind === "failed" && state.message).toContain("no network");
  });

  it("brings back a version that was dismissed", async () => {
    // Asking is saying they want to hear about it now.
    localStorage.setItem(DISMISSED_KEY, "0.5.0");
    plugins.check.mockResolvedValue(update("0.5.0"));

    await checkForUpdates({ manual: true });

    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });
});

describe("the hourly check", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it("checks at launch and again every hour", async () => {
    stop = startUpdateChecks();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugins.check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHECK_MS - 1);
    expect(plugins.check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(plugins.check).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(plugins.check).toHaveBeenCalledTimes(3);
  });

  it("stops when asked", async () => {
    stop = startUpdateChecks();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    await vi.advanceTimersByTimeAsync(CHECK_MS * 3);

    expect(plugins.check).toHaveBeenCalledTimes(1);
  });
});
