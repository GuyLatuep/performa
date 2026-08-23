import cheerUrl from "./assets/sounds/cheer.mp3";
// Globbed rather than imported: a plain import of a file that is not there
// fails the build, while this yields an empty object. The fanfare stays silent
// until somebody drops the file in, and the build never depends on whether
// they have.
const fanfareModules = import.meta.glob<{ default: string }>(
  "./assets/sounds/fanfare.mp3",
  { eager: true },
);
const fanfareUrl = Object.values(fanfareModules)[0]?.default;
import messageUrl from "./assets/sounds/icq-message.wav";
import { logDebug } from "./log";
import { getFunMode } from "./settings";

/**
 * The noises fun mode makes.
 *
 * Every one of them is a no-op while fun mode is off, checked here rather than
 * at each call site — a caller should be able to say "a worklog landed" without
 * also knowing whether the app is in a mood to celebrate.
 *
 * Nothing here is allowed to matter: a browser that refuses to play (no output
 * device, autoplay policy, a codec it dislikes) must not take the worklog or
 * the notification down with it.
 */

/** Held per sound so a burst of notifications reuses one element rather than
 *  leaving a pile of them for the GC. */
const players = new Map<string, HTMLAudioElement>();

function play(url: string, volume: number): void {
  if (!getFunMode()) return;
  try {
    let audio = players.get(url);
    if (!audio) {
      audio = new Audio(url);
      players.set(url, audio);
    }
    audio.volume = volume;
    // Rewound rather than left to finish: two mentions in quick succession
    // should sound twice, not once.
    audio.currentTime = 0;
    void audio.play().catch((err) => logDebug(`sound suppressed: ${err}`));
  } catch (err) {
    logDebug(`sound failed: ${err}`);
  }
}

/** A worklog was filed. */
export function playCheer(): void {
  play(cheerUrl, 0.5);
}

/** Something arrived — a mention, or a missing worklog. */
export function playMessage(): void {
  // Quieter than the cheer: this one arrives unbidden, and the cheer answers
  // something the user just did.
  play(messageUrl, 0.35);
}

/** The rare one — every tenth worklog. Falls back to the ordinary cheer while
 *  there is no fanfare to play, so the tenth is never quieter than the ninth. */
export function playFanfare(): void {
  if (fanfareUrl) play(fanfareUrl, 0.6);
  else playCheer();
}
