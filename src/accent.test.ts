import { beforeEach, describe, expect, it, vi } from "vitest";

// accent.ts reflects the restored accent onto <html> at import time. There is
// no DOM under the node environment, so stand in for the one property it sets.
// Hoisted, because the import below runs before any top-level statement would.
const style = vi.hoisted(() => {
  const style = { setProperty: vi.fn() };
  vi.stubGlobal("document", { documentElement: { style } });
  return style;
});

import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  INK_DARK,
  INK_LIGHT,
  contrastRatio,
  contrastingInk,
} from "./accent";

/** WCAG AA for normal-size text. Accent fills carry button and tab labels. */
const AA = 4.5;

beforeEach(() => {
  style.setProperty.mockClear();
});

describe("contrastRatio", () => {
  it("spans the full 1..21 range", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#7f7f7f", "#7f7f7f")).toBeCloseTo(1, 5);
  });

  it("does not care which colour is named first", () => {
    expect(contrastRatio(INK_DARK, "#3db4ff")).toBeCloseTo(
      contrastRatio("#3db4ff", INK_DARK),
      10,
    );
  });
});

describe("contrastingInk", () => {
  it("clears AA for every shipped preset", () => {
    for (const preset of ACCENT_PRESETS) {
      const ink = contrastingInk(preset.value);
      expect(
        contrastRatio(ink, preset.value),
        `${preset.label} (${preset.value}) on ${ink}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("clears AA for the default accent", () => {
    expect(
      contrastRatio(contrastingInk(DEFAULT_ACCENT), DEFAULT_ACCENT),
    ).toBeGreaterThanOrEqual(AA);
  });

  // The regression this function was rewritten for: weighting the raw channels
  // reads these two as light and puts light ink on them, at 2.8:1 and 2.1:1.
  it.each([
    ["pink", "#ff3dc4"],
    ["light blue", "#3db4ff"],
  ])("puts dark ink on the saturated mid-tone %s", (_label, fill) => {
    expect(contrastingInk(fill)).toBe(INK_DARK);
  });

  it("puts light ink on a genuinely dark fill", () => {
    expect(contrastingInk("#1a2b6b")).toBe(INK_LIGHT);
  });

  it("picks the better of the two inks, whatever the fill", () => {
    for (const fill of [
      "#000000",
      "#ffffff",
      "#808080",
      "#e6ff3d",
      "#3d0a2f",
    ]) {
      const chosen = contrastRatio(contrastingInk(fill), fill);
      const other = Math.max(
        contrastRatio(INK_DARK, fill),
        contrastRatio(INK_LIGHT, fill),
      );
      expect(chosen).toBeCloseTo(other, 10);
    }
  });
});

describe("applyAccent", () => {
  it("writes the fill and its matching ink onto the document element", async () => {
    const { applyAccent } = await import("./accent");

    applyAccent("#ff3dc4");

    expect(style.setProperty).toHaveBeenCalledWith("--accent", "#ff3dc4");
    expect(style.setProperty).toHaveBeenCalledWith("--accent-ink", INK_DARK);
  });
});

describe("setAccent", () => {
  const STORAGE_KEY = "performa-accent";

  /** Fresh module over a seeded storage — the store resolves its initial
   *  value once, at import, and applies it to the document there too. */
  async function freshAccent(stored?: string) {
    localStorage.clear();
    if (stored !== undefined) localStorage.setItem(STORAGE_KEY, stored);
    vi.resetModules();
    style.setProperty.mockClear();
    return import("./accent");
  }

  it("stores a valid colour and reflects it onto the document", async () => {
    const { setAccent, getAccent } = await freshAccent();

    setAccent("#ff3dc4");

    expect(getAccent()).toBe("#ff3dc4");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("#ff3dc4");
    expect(style.setProperty).toHaveBeenCalledWith("--accent", "#ff3dc4");
  });

  it("ignores anything that is not a six-digit hex colour", async () => {
    // The value reaches here from a colour input and from storage, so a
    // half-typed or hand-edited one must leave the accent alone rather than
    // write a broken CSS variable the whole app then renders through.
    const { setAccent, getAccent } = await freshAccent("#ff3dc4");
    style.setProperty.mockClear();

    for (const bad of ["", "nope", "#fff", "#ff3dc", "#ff3dc44", "ff3dc4"]) {
      setAccent(bad);
    }

    expect(getAccent()).toBe("#ff3dc4");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("#ff3dc4");
    expect(style.setProperty).not.toHaveBeenCalled();
  });

  it("takes a hex colour in either case", async () => {
    const { setAccent, getAccent } = await freshAccent();

    setAccent("#AABBCC");

    expect(getAccent()).toBe("#AABBCC");
  });

  it("falls back to the default when storage holds something unusable", async () => {
    const { getAccent } = await freshAccent("not-a-colour");

    expect(getAccent()).toBe(DEFAULT_ACCENT);
  });

  it("restores a stored colour on the next launch", async () => {
    const { getAccent } = await freshAccent("#123456");

    expect(getAccent()).toBe("#123456");
  });
});
