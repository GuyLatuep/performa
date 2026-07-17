import { createStore } from "./store";
import { IssueSummary } from "./api";

// Issues pinned to the top of the log-work list. Stored locally (key +
// summary) so they render even when a pinned issue no longer appears in
// the search results.

const PINS_KEY = "performa-pinned-issues";

function readPins(): IssueSummary[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p): p is IssueSummary =>
        !!p && typeof p.key === "string" && typeof p.summary === "string",
    );
  } catch {
    return [];
  }
}

const pinsStore = createStore<IssueSummary[]>(readPins());

function save(pins: IssueSummary[]): void {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  pinsStore.set(pins);
}

export function usePinnedIssues(): IssueSummary[] {
  return pinsStore.use();
}

export function togglePin(issue: IssueSummary): void {
  const pins = pinsStore.get();
  save(
    pins.some((p) => p.key === issue.key)
      ? pins.filter((p) => p.key !== issue.key)
      : [...pins, issue],
  );
}
