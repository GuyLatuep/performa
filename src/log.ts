import { invoke } from "@tauri-apps/api/core";

// Deliberately independent of api.ts (which imports this module to log its
// own calls) — importing api.ts here would create a cycle.

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Append a line to the on-disk debug log; never throws. */
export function logToFile(level: LogLevel, message: string): void {
  // Swallowed rather than reported, because the only way to report it would be
  // to log — and a logging call that fails once will fail again on the line
  // complaining about it. An unhandled rejection out of every log call is the
  // other end of that trade, and worse.
  invoke("frontend_log", { level, message }).catch(() => {});
}

export const logError = (message: string) => logToFile("error", message);
export const logWarn = (message: string) => logToFile("warn", message);
export const logInfo = (message: string) => logToFile("info", message);
export const logDebug = (message: string) => logToFile("debug", message);
