import { useSyncExternalStore } from "react";
import { WorklogInput } from "./api";

/**
 * "A worklog was filed", announced once from the write itself.
 *
 * The alternative was threading an `onLogged` callback from every log form up
 * to the shell and back down into the views that refresh, most of which only
 * passed it along. `api.logWork` already carries the one side effect every
 * caller needs — `invalidateCachedReads` — for exactly that reason; this is the
 * same argument.
 *
 * Deliberately free of anything it notifies: the data layer announces, and
 * whatever cares subscribes from above.
 */
const listeners = new Set<(worklog: WorklogInput) => void>();

let filedCount = 0;

export function reportWorklogFiled(worklog: WorklogInput): void {
  filedCount += 1;
  for (const listener of listeners) listener(worklog);
}

export function onWorklogFiled(
  listener: (worklog: WorklogInput) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How many worklogs this app has filed so far. A view that shows booked time
 *  puts it in an effect's dependencies to read again after each one. */
export function useWorklogsFiled(): number {
  return useSyncExternalStore(onWorklogFiled, () => filedCount);
}
