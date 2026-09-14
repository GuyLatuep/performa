import { openUrl } from "@tauri-apps/plugin-opener";
import { logWarn } from "./log";

// The English manual links to the German one via its language switcher.
export const HANDBOOK_URL =
  "https://github.com/GuyLatuep/performa/blob/main/docs/user-manual.en.md";

/**
 * Hand a URL to the desktop's browser or mail client.
 *
 * Always through here, never `openUrl` directly: the shell can refuse — the
 * URL has to match the opener scope in `capabilities/default.json`, and the
 * platform call itself can fail — and a bare `openUrl` leaves that rejection
 * floating, so a link that opens nothing says nothing either, to the user or
 * to the log.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (err) {
    logWarn(`opening ${url} failed: ${err}`);
  }
}
