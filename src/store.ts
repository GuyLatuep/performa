import { useSyncExternalStore } from "react";

/** Minimal external store: one mutable value, subscribers, and a React hook.
 *  The theme / timer / settings / missing stores are all instances of this. */
export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
  /** React hook returning the current value, re-rendering on change. */
  use: () => T;
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
      value = next;
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, get, get),
  };
}
