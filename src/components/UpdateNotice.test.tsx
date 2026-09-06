/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import UpdateNotice from "./UpdateNotice";

// The banner talks to three Tauri plugins, none of which exist under vitest.
// What is under test is what it does with their answers: whether it shows at
// all, the progress it reports while installing, and what a dismissal sticks.

const DISMISSED_KEY = "performa-update-dismissed";

const plugins = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugins.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugins.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: plugins.openUrl }));

/** The progress callback Tauri hands the download, so a test can drive it. */
type OnEvent = (event: {
  event: "Started" | "Progress" | "Finished";
  data: { contentLength?: number; chunkLength: number };
}) => void;

/** An available update, with a hook for steering its download. */
function update({
  version = "0.5.0",
  currentVersion = "0.4.0",
  downloadAndInstall = vi.fn(async () => undefined),
}: {
  version?: string;
  currentVersion?: string;
  downloadAndInstall?: (onEvent: OnEvent) => Promise<undefined>;
} = {}) {
  return { version, currentVersion, downloadAndInstall };
}

/** Mount the banner over an available update and wait for it to appear. */
async function showing(found = update()) {
  plugins.check.mockResolvedValue(found);
  render(<UpdateNotice />);
  await screen.findByText(/is available/);
  return found;
}

const banner = () => screen.queryByText(/is available/);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  plugins.check.mockResolvedValue(null);
});

describe("whether the banner shows at all", () => {
  it("stays away when the app is current", async () => {
    render(<UpdateNotice />);
    await act(async () => {});

    expect(banner()).toBeNull();
  });

  it("stays away when the check fails", async () => {
    // Update checks are best-effort; a GitHub outage must not put an error in
    // front of someone trying to log time.
    plugins.check.mockRejectedValue(new Error("no network"));
    render(<UpdateNotice />);
    await act(async () => {});

    expect(banner()).toBeNull();
  });

  it("names both versions once a release is out", async () => {
    await showing(update({ version: "0.5.0", currentVersion: "0.4.0" }));

    expect(screen.getByText("0.5.0")).toBeDefined();
    expect(screen.getByText(/you are on/)).toBeDefined();
  });

  it("stays away for a version already dismissed", async () => {
    localStorage.setItem(DISMISSED_KEY, "0.5.0");
    plugins.check.mockResolvedValue(update({ version: "0.5.0" }));

    render(<UpdateNotice />);
    await act(async () => {});

    expect(banner()).toBeNull();
  });

  it("comes back for the next release after a dismissal", async () => {
    // Dismissing hides the banner for that version only.
    localStorage.setItem(DISMISSED_KEY, "0.5.0");
    plugins.check.mockResolvedValue(update({ version: "0.6.0" }));

    render(<UpdateNotice />);

    expect(await screen.findByText("0.6.0")).toBeDefined();
  });
});

describe("dismissing", () => {
  it("hides the banner and remembers the version", async () => {
    await showing(update({ version: "0.5.0" }));

    await userEvent.click(screen.getByTitle("Dismiss for this version"));

    expect(banner()).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("0.5.0");
  });
});

describe("release notes", () => {
  it("opens the releases page in a real browser", async () => {
    // Not in the webview: the app has no back button.
    await showing();

    await userEvent.click(
      screen.getByRole("button", { name: "Release notes" }),
    );

    expect(plugins.openUrl).toHaveBeenCalledWith(
      "https://github.com/GuyLatuep/performa/releases/latest",
    );
  });
});

describe("installing", () => {
  /** Show the banner over a download the test drives by hand. */
  async function installable() {
    let emit!: OnEvent;
    let finish!: () => void;
    const downloadAndInstall = vi.fn((onEvent: OnEvent) => {
      emit = onEvent;
      return new Promise<undefined>((r) => (finish = () => r(undefined)));
    });
    await showing(update({ downloadAndInstall }));
    await userEvent.click(
      screen.getByRole("button", { name: "Update & restart" }),
    );
    return {
      downloadAndInstall,
      emit: async (...events: Parameters<OnEvent>[0][]) => {
        await act(async () => {
          for (const e of events) emit(e);
        });
      },
      finish: async () => {
        await act(async () => {
          finish();
        });
      },
    };
  }

  it("reports progress as a percentage of the download", async () => {
    const install = await installable();

    await install.emit(
      { event: "Started", data: { contentLength: 1000, chunkLength: 0 } },
      { event: "Progress", data: { chunkLength: 250 } },
    );

    expect(screen.getByText("Downloading… 25%")).toBeDefined();
  });

  it("adds chunks up as they arrive", async () => {
    const install = await installable();

    await install.emit(
      { event: "Started", data: { contentLength: 1000, chunkLength: 0 } },
      { event: "Progress", data: { chunkLength: 250 } },
      { event: "Progress", data: { chunkLength: 250 } },
    );

    expect(screen.getByText("Downloading… 50%")).toBeDefined();
  });

  it("switches to installing at the end", async () => {
    const install = await installable();

    await install.emit(
      { event: "Started", data: { contentLength: 1000, chunkLength: 0 } },
      { event: "Finished", data: { chunkLength: 0 } },
    );

    expect(screen.getByText("Installing…")).toBeDefined();
  });

  it("never claims more than a whole download", async () => {
    // A server that overshoots the advertised length must not read as 130%.
    // The `progress < 100` branch is what guarantees that on screen; the
    // `Math.min` behind it is belt-and-braces and makes no visible difference.
    const install = await installable();

    await install.emit(
      { event: "Started", data: { contentLength: 1000, chunkLength: 0 } },
      { event: "Progress", data: { chunkLength: 1300 } },
    );

    expect(screen.getByText("Installing…")).toBeDefined();
  });

  it("says nothing numeric when the size is unknown", async () => {
    // Dividing by a zero content length would put NaN% on screen.
    const install = await installable();

    await install.emit(
      { event: "Started", data: { chunkLength: 0 } },
      { event: "Progress", data: { chunkLength: 250 } },
    );

    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText("Downloading… 0%")).toBeDefined();
  });

  it("takes the buttons away while it runs", async () => {
    // Dismissing or re-triggering mid-install has nothing good to do.
    const install = await installable();

    await install.emit({
      event: "Started",
      data: { contentLength: 1000, chunkLength: 0 },
    });

    expect(
      screen.queryByRole("button", { name: "Update & restart" }),
    ).toBeNull();
    expect(screen.queryByTitle("Dismiss for this version")).toBeNull();
  });

  it("restarts into the new version once installed", async () => {
    const install = await installable();

    await install.finish();

    await waitFor(() => expect(plugins.relaunch).toHaveBeenCalledTimes(1));
  });

  it("shows the failure and offers the buttons again", async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error("disk full");
    });
    await showing(update({ downloadAndInstall }));

    await userEvent.click(
      screen.getByRole("button", { name: "Update & restart" }),
    );

    expect(
      await screen.findByText(/Update failed: Error: disk full/),
    ).toBeDefined();
    // Recoverable: a second attempt has to be possible.
    expect(
      screen.getByRole("button", { name: "Update & restart" }),
    ).toBeDefined();
    expect(plugins.relaunch).not.toHaveBeenCalled();
  });

  it("can be retried after a failure", async () => {
    const downloadAndInstall = vi
      .fn<(cb: OnEvent) => Promise<undefined>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    await showing(update({ downloadAndInstall }));

    await userEvent.click(
      screen.getByRole("button", { name: "Update & restart" }),
    );
    await screen.findByText(/Update failed/);
    await userEvent.click(
      screen.getByRole("button", { name: "Update & restart" }),
    );

    await waitFor(() => expect(plugins.relaunch).toHaveBeenCalledTimes(1));
  });

  it("does not let the hourly re-check disturb a running install", async () => {
    // The install button is gone the moment a download starts, so the guard
    // this protects is the periodic check. Its effect only becomes visible
    // once an install fails and the banner comes back: it must offer the
    // version the user was actually installing, not one swapped in behind it.
    vi.useFakeTimers();
    try {
      let fail!: (err: Error) => void;
      const downloadAndInstall = vi.fn(
        () => new Promise<undefined>((_, reject) => (fail = reject)),
      );
      plugins.check.mockResolvedValue(
        update({ version: "0.5.0", downloadAndInstall }),
      );
      render(<UpdateNotice />);
      await act(async () => {});
      await act(async () => {
        screen.getByRole("button", { name: "Update & restart" }).click();
      });
      expect(screen.getByText(/Downloading…/)).toBeDefined();

      // An hour goes by mid-download and a newer release has landed.
      plugins.check.mockResolvedValue(update({ version: "0.6.0" }));
      await act(async () => {
        vi.advanceTimersByTime(60 * 60 * 1000);
      });
      await act(async () => {});
      expect(screen.getByText(/Downloading…/)).toBeDefined();

      await act(async () => {
        fail(new Error("disk full"));
      });
      await act(async () => {});

      expect(screen.getByText("0.5.0")).toBeDefined();
      expect(screen.queryByText("0.6.0")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
