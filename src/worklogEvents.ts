import { WorklogInput } from "./api";

/**
 * "A worklog was filed", announced once from the write itself.
 *
 * The alternative was threading the duration back up through eleven `onLogged`
 * props, most of which only pass it along. `api.logWork` already carries the
 * one side effect every caller needs — `invalidateCachedReads` — for exactly
 * that reason; this is the same argument.
 *
 * Deliberately dependency-free: the data layer announces, and whatever cares
 * about celebrating subscribes from above.
 */
const listeners = new Set<(worklog: WorklogInput) => void>();

export function reportWorklogFiled(worklog: WorklogInput): void {
  for (const listener of listeners) listener(worklog);
}

export function onWorklogFiled(
  listener: (worklog: WorklogInput) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
