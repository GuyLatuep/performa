import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { logDebug, logWarn } from "./log";

/** Send a desktop notification; a no-op when permission is denied or the
 *  platform call fails — notifications must never break the app. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    } else {
      logDebug(`notification suppressed (permission not granted): ${title}`);
    }
  } catch (err) {
    logWarn(`notify("${title}") failed: ${err}`);
  }
}
