import { describe, expect, it } from "vitest";
import { isKonami, KONAMI_CODE, pushKey } from "./konami";

/** Feed a run of keys through from nothing. */
function enter(keys: string[]): string[] {
  return keys.reduce<string[]>((recent, key) => pushKey(recent, key), []);
}

describe("the konami code", () => {
  it("lands on the whole code", () => {
    expect(isKonami(enter(KONAMI_CODE))).toBe(true);
  });

  it("does not land one key short", () => {
    expect(isKonami(enter(KONAMI_CODE.slice(0, -1)))).toBe(false);
  });

  it("takes the letters in either case", () => {
    const shouted = KONAMI_CODE.map((k) => (k.length === 1 ? "B" : k));
    // Only the B is shouted; A stays lower so both paths are covered.
    expect(isKonami(enter([...shouted.slice(0, -1), "a"]))).toBe(true);
  });

  it("does not land on a wrong key part-way", () => {
    expect(isKonami(enter(["ArrowUp", "ArrowUp", "x"]))).toBe(false);
  });

  it("ignores whatever was pressed beforehand", () => {
    // A counter has to decide what a mismatch means and gets some sequence
    // wrong; a rolling window has no such rule.
    expect(isKonami(enter(["ArrowUp", ...KONAMI_CODE]))).toBe(true);
    expect(isKonami(enter(["x", "Enter", "ArrowDown", ...KONAMI_CODE]))).toBe(
      true,
    );
  });

  it("does not land on the code with something typed after it", () => {
    expect(isKonami(enter([...KONAMI_CODE, "x"]))).toBe(false);
  });

  it("keeps only as many keys as the code is long", () => {
    expect(enter(["x", "y", ...KONAMI_CODE])).toHaveLength(KONAMI_CODE.length);
  });

  it("is false for nothing pressed at all", () => {
    expect(isKonami([])).toBe(false);
  });
});
