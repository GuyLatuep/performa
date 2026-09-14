import { beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl, logWarn } = vi.hoisted(() => ({
  openUrl: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("./log", () => ({ logWarn }));

import { HANDBOOK_URL, openExternal } from "./external";

describe("openExternal", () => {
  beforeEach(() => {
    openUrl.mockReset();
    openUrl.mockResolvedValue(undefined);
    logWarn.mockReset();
  });

  it("hands the URL to the shell", async () => {
    await openExternal(HANDBOOK_URL);
    expect(openUrl).toHaveBeenCalledWith(HANDBOOK_URL);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("opens a mail address, which the opener scope has to allow", async () => {
    await openExternal("mailto:malte@polz.in");
    expect(openUrl).toHaveBeenCalledWith("mailto:malte@polz.in");
  });

  it("says so in the log when the shell refuses", async () => {
    openUrl.mockRejectedValue(new Error("Not allowed to open url"));
    await openExternal("mailto:malte@polz.in");
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining("mailto:malte@polz.in"),
    );
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining("Not allowed to open url"),
    );
  });

  it("keeps a failure to itself otherwise — a dead link is not a crash", async () => {
    openUrl.mockRejectedValue(new Error("no browser"));
    await expect(openExternal("https://example.test")).resolves.toBeUndefined();
  });
});
