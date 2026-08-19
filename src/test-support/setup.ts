import { beforeEach, vi } from "vitest";

// Under vitest there is neither a browser nor a Rust side, but the store
// modules reach for both the moment they are imported: they read localStorage
// to restore their state and push the restored value over IPC. Both are
// replaced here, once, for every test file.

/** In-memory stand-in for the browser's localStorage. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}

vi.stubGlobal("localStorage", memoryStorage());

// The pollers schedule themselves through `window.setTimeout` / `setInterval`,
// which node does not provide under that name. Pointing `window` at the global
// object keeps them pointed at the real (and, under fake timers, the faked)
// timer functions rather than at a second set of stubs.
vi.stubGlobal("window", globalThis);

// Tauri's real `invoke` reads window.__TAURI_INTERNALS__ and throws outright
// when it is missing, which would break at import time rather than resolve to
// a rejected promise.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

// Each test file starts from an empty store, whatever an earlier one wrote.
beforeEach(() => {
  localStorage.clear();
});
