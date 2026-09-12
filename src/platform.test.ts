/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPrimaryModifier, isMac, primaryGlyph } from "./platform";

/** Stand the app on one platform or the other. A function rather than a
 *  module constant is what lets this happen without `vi.resetModules()`. */
function on(platform: "mac" | "windows") {
  vi.stubGlobal("navigator", {
    userAgent:
      platform === "mac"
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });
}

/** A chord as the webview would deliver it. */
function chord(mods: Partial<KeyboardEventInit>) {
  return new KeyboardEvent("keydown", { key: "r", ...mods });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMac", () => {
  it.each([
    ["mac", true],
    ["windows", false],
  ] as const)("is %s → %s", (platform, expected) => {
    on(platform);
    expect(isMac()).toBe(expected);
  });
});

describe("primaryGlyph", () => {
  it("is the Command sign on a Mac and the word elsewhere", () => {
    on("mac");
    expect(primaryGlyph()).toBe("⌘");
    on("windows");
    expect(primaryGlyph()).toBe("Ctrl");
  });
});

describe("hasPrimaryModifier", () => {
  it("is Command on a Mac and Control on Windows", () => {
    on("mac");
    expect(hasPrimaryModifier(chord({ metaKey: true }))).toBe(true);
    expect(hasPrimaryModifier(chord({ ctrlKey: true }))).toBe(false);

    on("windows");
    expect(hasPrimaryModifier(chord({ ctrlKey: true }))).toBe(true);
    expect(hasPrimaryModifier(chord({ metaKey: true }))).toBe(false);
  });

  it("rejects a chord carrying both, which belongs to somebody else", () => {
    // ⌃⌘← is Spaces' on a Mac, and ⌃⌥ is AltGr on a European Windows layout.
    on("mac");
    expect(hasPrimaryModifier(chord({ metaKey: true, ctrlKey: true }))).toBe(
      false,
    );
  });

  it("rejects Alt, and allows Shift", () => {
    // Shift is how the catalogue spells the second variant of an action;
    // ⌥ changes what `key` reports and is nobody's shortcut here.
    on("mac");
    expect(hasPrimaryModifier(chord({ metaKey: true, altKey: true }))).toBe(
      false,
    );
    expect(hasPrimaryModifier(chord({ metaKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("is false with no modifier at all", () => {
    on("mac");
    expect(hasPrimaryModifier(chord({}))).toBe(false);
  });
});
