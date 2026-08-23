import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { logDebug, logWarn } from "./log";
import { playMessage } from "./fun";

/** Send a desktop notification; a no-op when permission is denied or the
 *  platform call fails — notifications must never break the app. */
export async function notify(title: string, body: string): Promise<void> {
  // Here rather than at the two call sites: this is what "a notification
  // happened" means, and both the mentions inbox and the missing-worklog scan
  // arrive through it. A no-op unless fun mode is on.
  playMessage();
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
