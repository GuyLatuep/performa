import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimStoredFor,
  persisted,
  persistedText,
  readStored,
  writeStored,
} from "./persist";

const KEY = "performa-test-key";

beforeEach(() => {
  localStorage.clear();
});

describe("readStored", () => {
  it("gives back what was stored", () => {
    writeStored(KEY, { a: 1 });
    expect(readStored(KEY)).toEqual({ a: 1 });
  });

  it("says undefined for a key nothing has been stored under", () => {
    expect(readStored(KEY)).toBeUndefined();
  });

  it("says undefined rather than throwing on storage that will not parse", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readStored(KEY)).toBeUndefined();
  });

  it("says undefined when the browser refuses storage altogether", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    try {
      expect(readStored(KEY)).toBeUndefined();
    } finally {
      getItem.mockRestore();
    }
  });

  it("cannot tell a stored null from an absent key, so writing one removes it", () => {
    writeStored(KEY, 7);
    writeStored(KEY, null);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("persisted", () => {
  it("starts from what parse makes of the stored value", () => {
    writeStored(KEY, ["a", 2, "b"]);
    const store = persisted<string[]>(KEY, (stored) =>
      Array.isArray(stored) ? stored.filter((s) => typeof s === "string") : [],
    );
    expect(store.get()).toEqual(["a", "b"]);
  });

  it("hands parse undefined when there is nothing usable", () => {
    localStorage.setItem(KEY, "{not json");
    const seen: unknown[] = [];
    persisted<string>(KEY, (stored) => {
      seen.push(stored);
      return "fallback";
    });
    expect(seen).toEqual([undefined]);
  });

  it("writes through on save and wakes subscribers", () => {
    const store = persisted<number>(KEY, (stored) =>
      typeof stored === "number" ? stored : 0,
    );
    const woken = vi.fn();
    store.subscribe(woken);

    store.save(3);

    expect(readStored(KEY)).toBe(3);
    expect(store.get()).toBe(3);
    expect(woken).toHaveBeenCalledTimes(1);
  });

  it("stores the encoded shape but holds the value", () => {
    const store = persisted<string[]>(
      KEY,
      (stored) =>
        (stored as { names?: string[] } | undefined)?.names ?? ["default"],
      (names) => ({ names, version: 2 }),
    );

    store.save(["one"]);

    expect(readStored(KEY)).toEqual({ names: ["one"], version: 2 });
    expect(store.get()).toEqual(["one"]);
  });
});

describe("persistedText", () => {
  it("reads and writes the value unquoted", () => {
    localStorage.setItem(KEY, "dark");
    const store = persistedText<"light" | "dark">(KEY, (raw) =>
      raw === "dark" ? "dark" : "light",
    );
    expect(store.get()).toBe("dark");

    store.save("light");
    expect(localStorage.getItem(KEY)).toBe("light");
  });

  it("hands parse null for an unset key", () => {
    const store = persistedText<number>(KEY, (raw) =>
      raw === null ? 8 : parseFloat(raw),
    );
    expect(store.get()).toBe(8);
  });
});

describe("claimStoredFor", () => {
  it("keeps everything when the same account comes back", () => {
    localStorage.setItem("owner", "alice");
    localStorage.setItem(KEY, "hers");

    expect(claimStoredFor("owner", "alice", [KEY])).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("hers");
  });

  it("drops the claimed keys for somebody else, and says it did", () => {
    localStorage.setItem("owner", "alice");
    localStorage.setItem(KEY, "hers");

    expect(claimStoredFor("owner", "bob", [KEY])).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem("owner")).toBe("bob");
  });

  it("claims a first sign-in, where there is no owner yet", () => {
    expect(claimStoredFor("owner", "alice", [KEY])).toBe(true);
    expect(localStorage.getItem("owner")).toBe("alice");
  });
});
