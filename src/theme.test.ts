import { describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "performa-theme";

// theme.ts reflects the restored theme onto <html> at import time and asks the
// OS for its preference when nothing is stored. Neither exists under the node
// environment, so both are stood in for here — the same shape accent.test.ts
// uses, and hoisted for the same reason: the module under test runs its
// top-level `applyTheme()` before any statement in this file would.
const dom = vi.hoisted(() => {
  const documentElement = { setAttribute: vi.fn() };
  const matchMedia = vi.fn(() => ({ matches: false }));
  vi.stubGlobal("document", { documentElement });
  vi.stubGlobal("window", { matchMedia });
  return { documentElement, matchMedia };
});

/** Fresh module over a seeded storage and a chosen OS preference — the store
 *  resolves its initial value once, at import. */
async function freshTheme({
  stored,
  systemDark,
}: { stored?: string; systemDark?: boolean } = {}) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(STORAGE_KEY, stored);
  dom.documentElement.setAttribute.mockClear();
  dom.matchMedia.mockReturnValue({ matches: systemDark ?? false });
  vi.resetModules();
  return import("./theme");
}

describe("the restored theme", () => {
  it("takes a stored choice over the system preference", async () => {
    const { getTheme } = await freshTheme({
      stored: "light",
      systemDark: true,
    });

    expect(getTheme()).toBe("light");
  });

  it("falls back to the system preference when nothing is stored", async () => {
    expect((await freshTheme({ systemDark: true })).getTheme()).toBe("dark");
    expect((await freshTheme({ systemDark: false })).getTheme()).toBe("light");
  });

  it("treats a stored value it does not recognise as nothing stored", async () => {
    // Hand-edited storage, or a value from a version that spelled it
    // differently. Falling back beats rendering an undefined theme.
    const { getTheme } = await freshTheme({
      stored: "solarized",
      systemDark: true,
    });

    expect(getTheme()).toBe("dark");
  });

  it("reaches the document on import, before anything is painted", async () => {
    await freshTheme({ stored: "dark" });

    expect(dom.documentElement.setAttribute).toHaveBeenCalledWith(
      "data-theme",
      "dark",
    );
  });
});

describe("setTheme", () => {
  it("stores the choice and reflects it onto the document", async () => {
    const { setTheme, getTheme } = await freshTheme({ stored: "light" });
    dom.documentElement.setAttribute.mockClear();

    setTheme("dark");

    expect(getTheme()).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(dom.documentElement.setAttribute).toHaveBeenCalledWith(
      "data-theme",
      "dark",
    );
  });

  it("survives a reload", async () => {
    const { setTheme } = await freshTheme({ systemDark: true });
    setTheme("light");

    // Same storage, fresh module — what the next launch sees.
    vi.resetModules();
    const { getTheme } = await import("./theme");

    expect(getTheme()).toBe("light");
  });
});
