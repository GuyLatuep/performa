import { IssueSummary } from "./api";
import { createStore } from "./store";

/**
 * An issue somebody asked for by key rather than picked off a list.
 *
 * The issue view has always been something a list opens — the Todo tab and the
 * Mentions tab each hold one and hand it the row that was clicked. Reaching an
 * issue by typing its key belongs to neither of them, so it is a request the app
 * shell answers instead, and this store is how it arrives there.
 *
 * Module-level for the same reason the other registries are: the command palette
 * sits outside the app tree entirely, and this is how it says something to it
 * without either one having to know where the other is mounted.
 */
const store = createStore<IssueSummary | null>(null);

/** Show this issue. The summary is usually unknown at this point — the view
 *  fetches it by key and fills it in. */
export function requestIssue(key: string): void {
  store.set({ key, summary: "" });
}

/** The issue being shown by key, or null — which is every other moment. */
export function useRequestedIssue(): IssueSummary | null {
  return store.use();
}

/** Stop showing it. This is the issue view's way out, so it is also what the
 *  back gesture reaches. */
export function clearIssueRequest(): void {
  store.set(null);
}
