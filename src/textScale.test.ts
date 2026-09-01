import { describe, expect, it, vi } from "vitest";

// textScale.ts writes the scale onto <html> at import time, and there is no DOM
// under the node environment. Hoisted so the stub is in place before the module
// under test is loaded.
const style = vi.hoisted(() => {
  const style = { setProperty: vi.fn() };
  vi.stubGlobal("document", { documentElement: { style } });
  return style;
});

const STORAGE_KEY = "performa-text-scale";

/** Fresh module over a seeded storage — the store reads it once at import. */
async function fresh(seed?: string) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(STORAGE_KEY, seed);
  style.setProperty.mockClear();
  vi.resetModules();
  return import("./textScale");
}

describe("text scale", () => {
  it("starts at normal with nothing stored", async () => {
    const { getTextScale } = await fresh();

    expect(getTextScale()).toBe("normal");
  });

  it("restores a stored value", async () => {
    const { getTextScale } = await fresh("larger");

    expect(getTextScale()).toBe("larger");
  });

  it.each(["", "huge", "1.5", "NORMAL"])(
    "falls back to normal for the stored value %o",
    async (stored) => {
      const { getTextScale } = await fresh(stored);

      expect(getTextScale()).toBe("normal");
    },
  );

  it("round-trips a value through storage", async () => {
    const { setTextScale, getTextScale } = await fresh();

    setTextScale("large");

    expect(getTextScale()).toBe("large");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("large");
  });

  it("applies the saved scale on import, before anything renders", async () => {
    await fresh("large");

    expect(style.setProperty).toHaveBeenCalledWith("--text-scale", "1.12");
  });

  it("writes the multiplier for the scale it is given", async () => {
    const { applyTextScale, SCALES } = await fresh();

    for (const scale of ["normal", "large", "larger"] as const) {
      style.setProperty.mockClear();
      applyTextScale(scale);
      expect(style.setProperty).toHaveBeenCalledWith(
        "--text-scale",
        String(SCALES[scale]),
      );
    }
  });

  it("only ever grows the text", async () => {
    const { SCALES } = await fresh();

    expect(SCALES.normal).toBe(1);
    expect(SCALES.large).toBeGreaterThan(SCALES.normal);
    expect(SCALES.larger).toBeGreaterThan(SCALES.large);
  });
});
