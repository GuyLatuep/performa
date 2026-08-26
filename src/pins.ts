import { createStore } from "./store";
import { IssueSummary } from "./api";

// Issues pinned to the top of the log-work list. Stored locally (key, summary
// and issue type) so they render even when a pinned issue no longer appears in
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
      : // Not the due date or the status: both move while the pin sits there,
        // and a snapshot would quietly go stale. The issue type is the
        // exception — it is what the row's icon is drawn from, and a type
        // effectively never changes.
        [
          ...pins,
          {
            key: issue.key,
            summary: issue.summary,
            issueType: issue.issueType,
            issueTypeIcon: issue.issueTypeIcon,
          },
        ],
  );
}
