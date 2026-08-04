import { useSyncExternalStore } from "react";

/** Minimal external store: one mutable value, subscribers, and a React hook.
 *  The theme / timer / settings / missing stores are all instances of this. */
export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
  /** React hook returning the current value, re-rendering on change. */
  use: () => T;
  /**
   * React hook returning one slice of the value, re-rendering only when that
   * slice itself changes — so a component watching `items` sits still while
   * an unrelated field like a "last checked" timestamp moves underneath it.
   *
   * `select` must return something stable while the store is unchanged: a
   * field, not a freshly built object or array, or React will see a new
   * snapshot on every check and loop.
   */
  useSelector: <S>(select: (value: T) => S) => S;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get,
    subscribe,
    set(next: T) {
      // Setting the value it already holds is not a change, so nobody needs
      // waking. Matters most for the stores holding a primitive (theme, accent,
      // the timesheet settings), where re-selecting the active option is an
      // ordinary thing for a user to do.
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, get, get),
    useSelector: <S>(select: (value: T) => S) =>
      useSyncExternalStore(
        subscribe,
        () => select(value),
        () => select(value),
      ),
  };
}
