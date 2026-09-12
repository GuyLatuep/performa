/** @vitest-environment happy-dom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./components/IssueView", () => ({
  default: ({
    issue,
    backLabel,
    onBack,
  }: {
    issue: { key: string };
    backLabel: string;
    onBack: () => void;
  }) => (
    <div>
      <p>
        viewing {issue.key} from {backLabel}
      </p>
      <button onClick={onBack}>leave the issue</button>
    </div>
  ),
}));
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
import { clearIssueRequest, requestIssue } from "./issueRequest";
import { setTimesheetView } from "./settings";

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
  // The chord is ⌘ here; which modifier a platform spells shortcuts with is
  // platform.test.ts's business.
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
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

describe("how wide the content column runs", () => {
  // Every view wants a reading measure except the month matrix, where width
  // is days on screen and summary before the ellipsis. The cap lives on the
  // content column, so the tab alone cannot decide it.
  afterEach(() => setTimesheetView("week"));

  it("keeps the cap on the week view", async () => {
    apiMock.credentialsStatus.mockResolvedValue(CREDS);
    const { container } = render(<App />);
    await screen.findByText("start panel");

    await userEvent.click(screen.getByRole("button", { name: "Timesheet" }));

    expect(container.querySelector(".content-wide")).toBeNull();
  });

  it("lifts it for the month matrix", async () => {
    // Set before the render: the toggle lives inside the stubbed tab, so the
    // store is the only way in from here.
    setTimesheetView("month");
    apiMock.credentialsStatus.mockResolvedValue(CREDS);
    const { container } = render(<App />);
    await screen.findByText("start panel");

    // Not on the way there — the start tab reads like every other view.
    expect(container.querySelector(".content-wide")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Timesheet" }));
    expect(container.querySelector(".content-wide")).not.toBeNull();

    // And it goes again on the way out.
    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(container.querySelector(".content-wide")).toBeNull();
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

describe("the tab shortcuts", () => {
  /** Press a chord at the body, so it bubbles to the window listener. */
  function chord(key: string) {
    fireEvent.keyDown(document.body, { key, metaKey: true });
  }

  it.each([
    ["⌘1", "1", "start panel"],
    ["⌘2", "2", "todo panel"],
    ["⌘3", "3", "log panel"],
    ["⌘4", "4", "timesheet panel"],
    ["⌘5", "5", "missing panel"],
    ["⌘6", "6", "mentions panel"],
  ])("%s reaches the %s", async (_label, key, panel) => {
    await renderSignedIn();

    await act(async () => chord(key));

    expect(screen.getByText(panel)).toBeDefined();
  });

  it("names its key on every tab, for a screen reader as well as the badge", async () => {
    await renderSignedIn();

    expect(
      screen
        .getByRole("button", { name: "Todo" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+2");
  });

  it("opens settings on ⌘,", async () => {
    await renderSignedIn();

    await act(async () => chord(","));

    expect(screen.getByText("settings screen")).toBeDefined();
  });

  it("leaves a tab switch alone while a comment is half written", async () => {
    // The draft rule: ⌘2 would throw those words away, so it stands down and the
    // press falls through to whoever else wants it.
    await renderSignedIn();
    const box = document.createElement("textarea");
    document.body.append(box);
    box.value = "half a comment";
    box.focus();

    await act(async () => {
      fireEvent.keyDown(box, { key: "2", metaKey: true });
    });

    expect(screen.getByText("start panel")).toBeDefined();
    box.remove();
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

describe("the app badge", () => {
  // The badge on the app icon is the only indication that survives the window
  // being behind something else, so it counts what is waiting across both
  // inboxes rather than reporting on one tab.
  it("counts both inboxes together", async () => {
    badges.missing = [{}, {}];
    badges.unseen = 2;
    mentionBadge.unread = 3;

    await renderSignedIn();

    expect(apiMock.setBadge).toHaveBeenCalledWith(5);
  });

  it("counts what is unseen, not what is merely listed", async () => {
    // Six findings the user has already looked at are not six things waiting.
    badges.missing = [{}, {}, {}, {}, {}, {}];
    badges.unseen = 0;
    mentionBadge.unread = 1;

    await renderSignedIn();

    expect(apiMock.setBadge).toHaveBeenCalledWith(1);
  });

  it("clears rather than showing a zero when nothing is waiting", async () => {
    await renderSignedIn();

    expect(apiMock.setBadge).toHaveBeenCalledWith(null);
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

describe("an issue reached by its key", () => {
  // Typing a key in the command palette asks for an issue that belongs to no
  // tab, so the shell shows it rather than a list doing so.

  afterEach(clearIssueRequest);

  it("replaces the tab's content, keeping the sidebar", async () => {
    await renderSignedIn();

    await act(async () => requestIssue("ABC-12"));

    expect(screen.getByText(/viewing ABC-12/)).toBeDefined();
    expect(screen.queryByText("start panel")).toBeNull();
    // Still in the app, not over it: the tabs are where they were.
    expect(screen.getByRole("button", { name: "Todo" })).toBeDefined();
  });

  it("says where going back leads, which is the tab underneath", async () => {
    await renderSignedIn();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "2", metaKey: true });
    });

    await act(async () => requestIssue("ABC-12"));

    expect(screen.getByText(/from Todo/)).toBeDefined();
  });

  it("gives the tab back when the issue is left", async () => {
    await renderSignedIn();
    await act(async () => requestIssue("ABC-12"));

    await userEvent.click(
      screen.getByRole("button", { name: "leave the issue" }),
    );

    expect(screen.getByText("start panel")).toBeDefined();
  });

  it("gives it back when another tab is asked for instead", async () => {
    // The tab was asked for, so the tab is what should be on screen.
    await renderSignedIn();
    await act(async () => requestIssue("ABC-12"));

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "4", metaKey: true });
    });

    expect(screen.getByText("timesheet panel")).toBeDefined();
  });
});
