import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

// createStore is the foundation every other store is built on (theme, accent,
// timer, settings, pins, templates, missing), so its subscribe/notify contract
// is worth pinning down.

describe("createStore", () => {
  it("holds the initial value until set", () => {
    const store = createStore(3);
    expect(store.get()).toBe(3);
    store.set(7);
    expect(store.get()).toBe(7);
  });

  it("notifies every subscriber on each set", () => {
    const store = createStore("a");
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.set("b");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    store.set("c");
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when set is handed the value it already holds", () => {
    const store = createStore("a");
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("a");
    expect(listener).not.toHaveBeenCalled();

    store.set("b");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("compares by identity, not by contents", () => {
    // Two equal-looking objects are still two values: the store cannot know
    // whether something nested changed, so it must notify.
    const store = createStore({ n: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    const same = store.get();
    store.set(same);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(1);
    unsubscribe();
    store.set(2);

    expect(listener).toHaveBeenCalledTimes(1);
    // The value still moves on — only the notification stopped.
    expect(store.get()).toBe(2);
  });

  it("unsubscribing one listener leaves the others intact", () => {
    const store = createStore(0);
    const kept = vi.fn();
    const dropped = vi.fn();
    store.subscribe(kept);
    store.subscribe(dropped)();

    store.set(1);

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("notifies subscribers with the new value already readable", () => {
    // Subscribers re-read via get(); if set() notified first, they would see
    // the stale value and React would render one update behind.
    const store = createStore("old");
    let seen: string | undefined;
    store.subscribe(() => {
      seen = store.get();
    });
    store.set("new");
    expect(seen).toBe("new");
  });
});
