/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";

vi.mock("./api", async () => {
  const { apiModule } = await import("./test-support/api");
  return apiModule();
});

// Every tab is stubbed to a marker. This file is about which one is shown and
// what the tab bar says — each tab's own behaviour is covered in its own file,
// and rendering them for real would drag in half the app.
function stub(name: string) {
  return { default: () => <p>{name} panel</p> };
}
vi.mock("./components/Start", () => stub("start"));
vi.mock("./components/Todo", () => stub("todo"));
vi.mock("./components/Timesheet", () => stub("timesheet"));
vi.mock("./components/MissingWorklogs", () => stub("missing"));
vi.mock("./components/Mentions", () => stub("mentions"));
vi.mock("./components/LogWork", () => ({
  default: ({ backLabel }: { backLabel?: string }) => (
    <p>log panel{backLabel ? ` from ${backLabel}` : ""}</p>
  ),
}));
vi.mock("./components/Settings", () => ({
  default: ({ existing }: { existing: unknown }) => (
    <p>{existing ? "settings" : "connect"} screen</p>
  ),
}));

// The chrome around the tabs: none of it is what this file is about, and each
// piece reaches for a Tauri plugin, canvas or a poller of its own.
vi.mock("./components/UpdateNotice", () => ({ default: () => null }));
vi.mock("./components/CloseGuard", () => ({ default: () => null }));
vi.mock("./components/Confetti", () => ({ default: () => null }));
vi.mock("./components/AchievementToast", () => ({ default: () => null }));
vi.mock("./components/TimerBar", () => ({ default: () => null }));
vi.mock("./components/WhatsNew", () => ({ default: () => null }));
vi.mock("./components/About", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close about</button>
  ),
}));

// The two pollers are silenced; their badge counts are fed in directly.
const badges = vi.hoisted(() => ({ missing: [] as unknown[], unseen: 0 }));
vi.mock("./missing", () => ({
  useMissing: () => badges.missing,
  useMissingUnseenCount: () => badges.unseen,
  startMissingPolling: vi.fn(),
  stopMissingPolling: vi.fn(),
  refreshMissing: vi.fn(async () => {}),
}));

const mentionBadge = vi.hoisted(() => ({ unread: 0 }));
vi.mock("./mentions", () => ({
  useMentionsUnreadCount: () => mentionBadge.unread,
  startMentionsPolling: vi.fn(),
  stopMentionsPolling: vi.fn(),
}));

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("./achievements", () => ({ recordEvent: vi.fn(() => []) }));
vi.mock("./fun", () => ({
  playCheer: vi.fn(),
  playFanfare: vi.fn(),
  playMessage: vi.fn(),
}));

import App from "./App";
import { apiMock, resetApiMock } from "./test-support/api";

const CREDS = {
  site: "https://example.atlassian.net",
  email: "me@example.com",
};

/** Render signed in, past the credential gate. */
async function renderSignedIn() {
  apiMock.credentialsStatus.mockResolvedValue(CREDS);
  render(<App />);
  await screen.findByText("start panel");
}

beforeEach(() => {
  resetApiMock();
  badges.missing = [];
  badges.unseen = 0;
  mentionBadge.unread = 0;
  openUrl.mockClear();
  localStorage.clear();
});

describe("before anything is known", () => {
  it("says it is loading", () => {
    apiMock.credentialsStatus.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByText(/Loading/)).toBeDefined();
  });

  it("offers a retry rather than sticking on loading when the keychain fails", async () => {
    apiMock.credentialsStatus.mockRejectedValueOnce(
      new Error("keychain locked"),
    );
    render(<App />);
    await screen.findByText(/keychain locked/);

    apiMock.credentialsStatus.mockResolvedValue(CREDS);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("start panel")).toBeDefined();
  });

  it("asks for a connection when none is stored", async () => {
    apiMock.credentialsStatus.mockResolvedValue(null);

    render(<App />);

    expect(await screen.findByText("connect screen")).toBeDefined();
  });
});

describe("the tab bar", () => {
  it("starts on the start tab", async () => {
    await renderSignedIn();

    expect(screen.getByText("start panel")).toBeDefined();
  });

  it("shows one panel at a time, and the one that was picked", async () => {
    await renderSignedIn();

    for (const [label, panel] of [
      ["Todo", "todo panel"],
      ["Timesheet", "timesheet panel"],
      ["Start", "start panel"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByText(panel)).toBeDefined();
      expect(screen.queryByText("mentions panel")).toBeNull();
    }
  });

  it("opens the log tab with nowhere to go back to on a manual visit", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(screen.getByText("log panel")).toBeDefined();
  });

  it("reaches the missing and mentions tabs", async () => {
    await renderSignedIn();

    await userEvent.click(
      screen.getByRole("button", { name: /Missing worklog/ }),
    );
    expect(screen.getByText("missing panel")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Mentions/ }));
    expect(screen.getByText("mentions panel")).toBeDefined();
  });
});

describe("the tab badges", () => {
  it("counts the unlogged findings", async () => {
    badges.missing = [{}, {}, {}];

    await renderSignedIn();

    expect(
      screen.getByRole("button", { name: /Missing worklog · 3/ }),
    ).toBeDefined();
  });

  it("marks the tab only while something is unseen", async () => {
    // The count is what there is; the alert is what is new.
    badges.missing = [{}];
    badges.unseen = 1;
    await renderSignedIn();

    expect(
      screen.getByRole("button", { name: /Missing worklog/ }).className,
    ).toContain("alert");
  });

  it("leaves the tab unmarked once the findings have been seen", async () => {
    badges.missing = [{}];
    badges.unseen = 0;

    await renderSignedIn();

    expect(
      screen.getByRole("button", { name: /Missing worklog/ }).className,
    ).not.toContain("alert");
  });

  it("counts and marks unread mentions", async () => {
    mentionBadge.unread = 2;

    await renderSignedIn();

    const tab = screen.getByRole("button", { name: /Mentions · 2/ });
    expect(tab.className).toContain("alert");
  });

  it("says nothing on either tab when there is nothing to say", async () => {
    await renderSignedIn();

    expect(
      screen.getByRole("button", { name: "Missing worklog" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Mentions" })).toBeDefined();
  });
});

describe("the account row", () => {
  it("names who is signed in", async () => {
    await renderSignedIn();

    expect(screen.getByText("me@example.com")).toBeDefined();
  });

  it("opens the settings screen", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("settings screen")).toBeDefined();
  });

  it("opens the handbook in the browser", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Handbook" }));

    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("http"));
  });

  it("opens and closes About", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "About" }));
    await userEvent.click(screen.getByRole("button", { name: "close about" }));

    expect(screen.getByText("start panel")).toBeDefined();
  });
});

describe("signing out", () => {
  it("asks first", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(screen.getByText("Sign out?")).toBeDefined();
    expect(apiMock.clearCredentials).not.toHaveBeenCalled();
  });

  it("backs out on No", async () => {
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await userEvent.click(screen.getByRole("button", { name: "No" }));

    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
    expect(apiMock.clearCredentials).not.toHaveBeenCalled();
  });

  it("clears the credentials and returns to the connect screen", async () => {
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    apiMock.credentialsStatus.mockResolvedValue(null);

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(apiMock.clearCredentials).toHaveBeenCalled());
    expect(await screen.findByText("connect screen")).toBeDefined();
  });
});
