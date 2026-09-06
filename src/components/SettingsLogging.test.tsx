/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { apiMock, resetApiMock } from "../test-support/api";
import SettingsLogging from "./SettingsLogging";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const settings = vi.hoisted(() => ({
  level: "info" as string,
  setLogLevel: vi.fn(),
}));
vi.mock("../settings", () => ({
  useLogLevel: () => settings.level,
  setLogLevel: settings.setLogLevel,
}));

const select = () => screen.getByRole("combobox") as HTMLSelectElement;

beforeEach(() => {
  resetApiMock();
  vi.clearAllMocks();
  settings.level = "info";
});

describe("the level picker", () => {
  it("offers every level, capitalised", () => {
    render(<SettingsLogging />);

    expect([...select().options].map((o) => o.textContent)).toEqual([
      "Error",
      "Warn",
      "Info",
      "Debug",
    ]);
  });

  it("keeps the values lowercase, as the backend takes them", () => {
    render(<SettingsLogging />);

    expect([...select().options].map((o) => o.value)).toEqual([
      "error",
      "warn",
      "info",
      "debug",
    ]);
  });

  it("shows the level in force", () => {
    settings.level = "debug";
    render(<SettingsLogging />);

    expect(select().value).toBe("debug");
  });

  it("stores a new level, which mirrors it to the Rust side", async () => {
    render(<SettingsLogging />);

    await userEvent.selectOptions(select(), "warn");

    expect(settings.setLogLevel).toHaveBeenCalledWith("warn");
  });
});

describe("reaching the log files", () => {
  it("opens the folder", async () => {
    render(<SettingsLogging />);

    await userEvent.click(
      screen.getByRole("button", { name: "Open log folder" }),
    );

    expect(apiMock.openLogFolder).toHaveBeenCalledTimes(1);
  });

  it("says why it could not be opened", async () => {
    apiMock.openLogFolder.mockRejectedValue(new Error("no such folder"));
    render(<SettingsLogging />);

    await userEvent.click(
      screen.getByRole("button", { name: "Open log folder" }),
    );

    expect(await screen.findByText(/Error: no such folder/)).toBeDefined();
  });

  it("clears a previous failure on the next try", async () => {
    apiMock.openLogFolder
      .mockRejectedValueOnce(new Error("no such folder"))
      .mockResolvedValueOnce(undefined);
    render(<SettingsLogging />);
    const open = screen.getByRole("button", { name: "Open log folder" });

    await userEvent.click(open);
    await screen.findByText(/no such folder/);
    await userEvent.click(open);

    expect(screen.queryByText(/no such folder/)).toBeNull();
  });
});
