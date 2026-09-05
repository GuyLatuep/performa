/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// Covered by its own file; here it only has to offer an issue to pick.
vi.mock("./IssuePicker", () => ({
  default: ({ onSelect }: { onSelect: (i: unknown) => void }) => (
    <button
      onClick={() => onSelect({ key: "ABC-1", summary: "Replace the pump" })}
    >
      pick ABC-1
    </button>
  ),
}));

import {
  apiMock,
  issueSummary,
  resetApiMock,
  worklogEntry,
} from "../test-support/api";
import LogWork from "./LogWork";

const ISSUE = issueSummary({ key: "ABC-1", summary: "Replace the pump" });

function renderLogWork(props: Partial<Parameters<typeof LogWork>[0]> = {}) {
  const onLogged = vi.fn();
  render(
    <LogWork
      site="https://example.atlassian.net"
      onLogged={onLogged}
      {...props}
    />,
  );
  return onLogged;
}

/** Get to the form with an issue already chosen. */
async function renderForm(props: Partial<Parameters<typeof LogWork>[0]> = {}) {
  const onLogged = renderLogWork({ initialIssue: ISSUE, ...props });
  await screen.findByLabelText(/Time spent/);
  return onLogged;
}

beforeEach(resetApiMock);

describe("picking an issue", () => {
  it("opens the picker when none was handed over", () => {
    renderLogWork();

    expect(screen.getByRole("button", { name: "pick ABC-1" })).toBeDefined();
    expect(screen.queryByLabelText(/Time spent/)).toBeNull();
  });

  it("goes straight to the form for an issue it was given", async () => {
    await renderForm();

    expect(screen.getByText("Replace the pump")).toBeDefined();
  });

  it("shows the form once one is picked", async () => {
    renderLogWork();

    await userEvent.click(screen.getByRole("button", { name: "pick ABC-1" }));

    expect(await screen.findByLabelText(/Time spent/)).toBeDefined();
  });
});

describe("the way back", () => {
  it("offers it while the caller's issue is still the one on screen", async () => {
    await renderForm({ backLabel: "Todo", onBack: vi.fn() });

    expect(screen.getByRole("button", { name: /Todo/ })).toBeDefined();
  });

  it("drops it once another issue is picked here", async () => {
    // From then on the log tab is where the user came from.
    renderLogWork({ backLabel: "Todo", onBack: vi.fn() });

    await userEvent.click(screen.getByRole("button", { name: "pick ABC-1" }));

    await screen.findByLabelText(/Time spent/);
    expect(screen.queryByRole("button", { name: /Todo/ })).toBeNull();
  });

  it("is absent on a manual visit", async () => {
    await renderForm();

    // "Choose a different issue" is always there; only the tab-return is not.
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Choose a different issue/ }),
    ).toBeDefined();
  });

  it("goes back to the picker on 'choose a different issue'", async () => {
    await renderForm();

    await userEvent.click(
      screen.getByRole("button", { name: /Choose a different issue/ }),
    );

    expect(screen.getByRole("button", { name: "pick ABC-1" })).toBeDefined();
  });
});

describe("logging", () => {
  it("sends the draft and says what was logged", async () => {
    const onLogged = await renderForm();

    await userEvent.type(screen.getByLabelText(/Time spent/), "2h");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 7200 }),
      ),
    );
    expect(await screen.findByText(/Logged 2h on ABC-1/)).toBeDefined();
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it("empties the form afterwards, ready for the next entry", async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(/Time spent/), "2h");

    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", ""),
    );
  });

  it("refuses a duration it cannot read, without calling the backend", async () => {
    const onLogged = await renderForm();

    await userEvent.type(screen.getByLabelText(/Time spent/), "soon");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a valid duration/)).toBeDefined();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it("keeps the draft and says why when Jira refuses", async () => {
    apiMock.logWork.mockRejectedValue(new Error("Jira returned 400"));
    const onLogged = await renderForm();
    await userEvent.type(screen.getByLabelText(/Time spent/), "2h");

    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "2h");
    expect(onLogged).not.toHaveBeenCalled();
  });
});

describe("the history below the form", () => {
  it("lists what is already logged, with a total", async () => {
    apiMock.issueWorklogs.mockResolvedValue([
      worklogEntry({ id: "1", timeSpentSeconds: 3600 }),
      worklogEntry({ id: "2", timeSpentSeconds: 1800 }),
    ]);

    await renderForm();

    expect(await screen.findByText("1h 30m")).toBeDefined();
  });

  it("says when there is none yet", async () => {
    await renderForm();

    expect(
      await screen.findByText("No time logged on this issue yet."),
    ).toBeDefined();
  });

  it("reports a failed history read without breaking the form", async () => {
    apiMock.issueWorklogs.mockRejectedValue(new Error("Jira returned 500"));

    await renderForm();

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
    expect(screen.getByLabelText(/Time spent/)).toBeDefined();
  });

  it("counts the entries it did not show rather than dropping them silently", async () => {
    apiMock.issueWorklogs.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) =>
        worklogEntry({ id: `w${i}`, timeSpentSeconds: 600 }),
      ),
    );

    await renderForm();

    expect(await screen.findByText(/\+ 2 older entries/)).toBeDefined();
  });

  it("uses the singular for exactly one hidden entry", async () => {
    apiMock.issueWorklogs.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) =>
        worklogEntry({ id: `w${i}`, timeSpentSeconds: 600 }),
      ),
    );

    await renderForm();

    expect(await screen.findByText(/\+ 1 older entry/)).toBeDefined();
  });

  it("reloads after a worklog is filed", async () => {
    await renderForm();
    await waitFor(() => expect(apiMock.issueWorklogs).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText(/Time spent/), "1h");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    await waitFor(() => expect(apiMock.issueWorklogs).toHaveBeenCalledTimes(2));
  });
});
