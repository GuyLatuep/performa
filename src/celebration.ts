import { useEffect, useState } from "react";
import {
  getAchievementState,
  isMilestoneLog,
  recordEvent,
} from "./achievements";
import { playCheer, playFanfare } from "./fun";
import { useFunMode } from "./settings";
import { onWorklogFiled } from "./worklogEvents";

export interface Celebration {
  /** Bumped to fire a burst of confetti. */
  confetti: number;
  /** How big that burst should be. */
  confettiPieces: number;
  /** Titles earned but not yet shown. */
  awards: string[];
}

/**
 * What fun mode does when a worklog is filed: the noise, the confetti and any
 * title it earned.
 *
 * Kept apart from the refreshing: this needs to know what was logged, which
 * `api.logWork` announces.
 */
export function useCelebration(): Celebration {
  const funMode = useFunMode();
  const [confetti, setConfetti] = useState(0);
  const [confettiPieces, setConfettiPieces] = useState(0);
  const [awards, setAwards] = useState<string[]>([]);

  useEffect(
    () =>
      onWorklogFiled((worklog) => {
        if (!funMode) return;
        const earned = recordEvent({
          kind: "logged",
          date: worklog.date,
          time: worklog.time,
        });
        // Rarer and louder every tenth time, counted after this one landed.
        if (isMilestoneLog(getAchievementState().loggedCount)) playFanfare();
        else playCheer();
        setConfettiPieces(confettiFor(worklog.timeSpentSeconds));
        setConfetti((c) => c + 1);
        if (earned.length > 0) setAwards(earned);
      }),
    [funMode],
  );

  return { confetti, confettiPieces, awards };
}

/**
 * How much confetti a worklog is worth.
 *
 * A quarter of an hour gets a handful and a full day gets the cannon, on a
 * curve rather than a straight line — the difference between fifteen minutes
 * and an hour should be visible, and the difference between seven hours and
 * eight need not be.
 */
function confettiFor(seconds: number): number {
  const hours = Math.max(0, seconds) / 3600;
  return Math.round(20 + 130 * Math.min(1, Math.sqrt(hours / 8)));
}
