import { beforeEach, describe, expect, it } from "vitest";
import { hasSigSet, readSigSet, writeSigSet } from "./seen";

const KEY = "performa-test-seen";

beforeEach(() => {
  localStorage.clear();
});

describe("readSigSet", () => {
  it("round-trips what was written", () => {
    writeSigSet(KEY, ["a", "b"]);

    expect(readSigSet(KEY)).toEqual(new Set(["a", "b"]));
  });

  it("is empty when nothing was ever stored", () => {
    expect(readSigSet(KEY)).toEqual(new Set());
  });

  it("is empty rather than throwing on malformed storage", () => {
    // Hand-edited storage, or a write interrupted half-way. The watchers call
    // this on every poll, so throwing here would take the tab down.
    localStorage.setItem(KEY, "{not json");

    expect(readSigSet(KEY)).toEqual(new Set());
  });

  it("is empty when the stored value is valid JSON but not a list", () => {
    localStorage.setItem(KEY, '{"a":1}');

    expect(readSigSet(KEY)).toEqual(new Set());
  });

  it("keeps only the strings out of a mixed list", () => {
    localStorage.setItem(KEY, '["a",1,null,"b",{"c":2}]');

    expect(readSigSet(KEY)).toEqual(new Set(["a", "b"]));
  });
});

describe("hasSigSet", () => {
  it("tells an empty stored set apart from never having stored one", () => {
    // The whole reason this function exists: `readSigSet` gives back an empty
    // set for both, and the watchers need to know whether a first scan has
    // happened — otherwise every finding on a fresh install looks new.
    expect(hasSigSet(KEY)).toBe(false);

    writeSigSet(KEY, []);

    expect(hasSigSet(KEY)).toBe(true);
    expect(readSigSet(KEY)).toEqual(new Set());
  });

  it("counts malformed storage as never stored, so it gets reseeded", () => {
    localStorage.setItem(KEY, "{not json");

    expect(hasSigSet(KEY)).toBe(false);
  });

  it("counts a non-list as never stored", () => {
    localStorage.setItem(KEY, '"a string"');

    expect(hasSigSet(KEY)).toBe(false);
  });
});
