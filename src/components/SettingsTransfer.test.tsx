/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { apiMock, resetApiMock } from "../test-support/api";
import SettingsTransfer from "./SettingsTransfer";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "2.6.2" }));

const plugins = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  relaunch: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: plugins.save,
  open: plugins.open,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugins.relaunch }));

const ME = { site: "https://acme.atlassian.net", email: "anna@acme.example" };

function file(settings: Record<string, string>, account: unknown = ME) {
  return JSON.stringify({ app: "performa", format: 1, account, settings });
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  resetApiMock();
  localStorage.clear();
});

describe("exporting", () => {
  it("suggests a dated file name and writes the settings there", async () => {
    localStorage.setItem("performa-theme", "dark");
    plugins.save.mockResolvedValue("/home/anna/settings.json");
    render(<SettingsTransfer account={ME} />);

    await userEvent.click(button("Export…"));

    expect(plugins.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(
          /^performa-settings-\d{4}-\d{2}-\d{2}\.json$/,
        ),
      }),
    );
    await waitFor(() => expect(apiMock.writeSettingsFile).toHaveBeenCalled());
    const [path, text] = apiMock.writeSettingsFile.mock.calls[0];
    expect(path).toBe("/home/anna/settings.json");
    expect(JSON.parse(text)).toMatchObject({
      appVersion: "2.6.2",
      account: ME,
      settings: { "performa-theme": "dark" },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "/home/anna/settings.json",
    );
  });

  it("does nothing when the dialog is cancelled", async () => {
    plugins.save.mockResolvedValue(null);
    render(<SettingsTransfer account={ME} />);

    await userEvent.click(button("Export…"));

    expect(apiMock.writeSettingsFile).not.toHaveBeenCalled();
    expect(document.querySelector(".error")).toBeNull();
  });

  it("says so when the file cannot be written", async () => {
    plugins.save.mockResolvedValue("/read-only/settings.json");
    apiMock.writeSettingsFile.mockRejectedValue("permission denied");
    render(<SettingsTransfer account={ME} />);

    await userEvent.click(button("Export…"));

    expect((await screen.findByText(/Couldn’t export/)).textContent).toContain(
      "permission denied",
    );
  });
});

describe("importing", () => {
  async function pick(text: string) {
    plugins.open.mockResolvedValue("/home/anna/settings.json");
    apiMock.readSettingsFile.mockResolvedValue(text);
    render(<SettingsTransfer account={ME} />);
    await userEvent.click(button("Import…"));
  }

  it("does nothing when the dialog is cancelled", async () => {
    plugins.open.mockResolvedValue(null);
    render(<SettingsTransfer account={ME} />);

    await userEvent.click(button("Import…"));

    expect(apiMock.readSettingsFile).not.toHaveBeenCalled();
  });

  it("turns away a file that is not a settings file, changing nothing", async () => {
    localStorage.setItem("performa-theme", "light");

    await pick('{"name":"package"}');

    expect(
      await screen.findByText("This is not a performa settings file."),
    ).toBeTruthy();
    expect(localStorage.getItem("performa-theme")).toBe("light");
    expect(plugins.relaunch).not.toHaveBeenCalled();
  });

  it("asks before replacing anything", async () => {
    localStorage.setItem("performa-theme", "light");

    await pick(file({ "performa-theme": "dark" }));

    expect(await screen.findByText(/Replace your settings/)).toBeTruthy();
    expect(localStorage.getItem("performa-theme")).toBe("light");
  });

  it("changes nothing on Keep", async () => {
    localStorage.setItem("performa-theme", "light");
    await pick(file({ "performa-theme": "dark" }));

    await userEvent.click(await screen.findByRole("button", { name: "Keep" }));

    expect(localStorage.getItem("performa-theme")).toBe("light");
    expect(plugins.relaunch).not.toHaveBeenCalled();
    expect(button("Import…")).toBeTruthy();
  });

  it("writes the settings and restarts on Replace", async () => {
    await pick(file({ "performa-theme": "dark" }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Replace" }),
    );

    expect(localStorage.getItem("performa-theme")).toBe("dark");
    expect(plugins.relaunch).toHaveBeenCalledOnce();
  });

  it("warns that Draft worklogs stay on the old computer", async () => {
    await pick(file({ "performa-drafts": "[]" }));

    expect(await screen.findByText(/not removed/)).toBeTruthy();
  });

  it("does not mention drafts when the file has none", async () => {
    await pick(file({ "performa-theme": "dark" }));

    await screen.findByText(/Replace your settings/);
    expect(screen.queryByText(/not removed/)).toBeNull();
  });
});

describe("importing from another account", () => {
  async function pick(account: unknown) {
    plugins.open.mockResolvedValue("/home/anna/settings.json");
    apiMock.readSettingsFile.mockResolvedValue(file({}, account));
    render(<SettingsTransfer account={ME} />);
    await userEvent.click(button("Import…"));
    await screen.findByText(/Replace your settings/);
  }

  it("warns which settings may not fit this site", async () => {
    await pick({ ...ME, site: "https://other.atlassian.net" });

    expect(screen.getByText(/another Jira account/).textContent).toMatch(
      /Saved searches.*issue field layout.*Todo statuses/,
    );
  });

  it("warns when the file does not say", async () => {
    await pick(null);

    expect(screen.getByText(/another Jira account/)).toBeTruthy();
  });

  it("stays quiet for the same account", async () => {
    await pick(ME);

    expect(screen.queryByText(/another Jira account/)).toBeNull();
  });

  it("still imports when confirmed", async () => {
    await pick({ ...ME, email: "bob@acme.example" });

    await userEvent.click(button("Replace"));

    expect(plugins.relaunch).toHaveBeenCalledOnce();
  });
});
