import { describe, expect, it } from "vitest";
import { IDLE_START, IdleState, observeIdle } from "./idle";

const MIN = 60_000;
const THRESHOLD = 10 * MIN;

/** Feed a run of readings through, collecting whatever away stretches they
 *  report. Each reading: [now, idle seconds, ms asleep since boot]. */
function run(readings: [number, number, number?][]) {
  let state: IdleState = IDLE_START;
  const found = [];
  for (const [now, idleSeconds, asleepMs = 0] of readings) {
    const r = observeIdle(state, {
      now,
      idleSeconds,
      asleepMs,
      thresholdMs: THRESHOLD,
    });
    state = r.state;
    if (r.away) found.push(r.away);
  }
  return found;
}

describe("observeIdle", () => {
  it("reports nothing while somebody is at the machine", () => {
    expect(
      run([
        [0, 5],
        [15_000, 2],
        [30_000, 40],
      ]),
    ).toEqual([]);
  });

  it("reports an away stretch once the user is back, not before", () => {
    // Last input at 0; readings show the idle time growing, then input again.
    const readings: [number, number][] = [
      [5 * MIN, 300],
      [11 * MIN, 660],
      [20 * MIN, 1200],
    ];
    expect(run(readings)).toEqual([]);

    expect(run([...readings, [25 * MIN, 60]])).toEqual([
      // From the last input before to the first input after.
      { from: 0, to: 24 * MIN },
    ]);
  });

  it("lets a pause shorter than the threshold go", () => {
    expect(
      run([
        [5 * MIN, 300],
        [9 * MIN, 540],
        [10 * MIN, 1],
      ]),
    ).toEqual([]);
  });

  it("catches a sleep the idle counter forgot", () => {
    // Lid closed at 2 min after the last input; the key that wakes the
    // machine resets the idle counter, so only the sleep reading tells.
    expect(
      run([
        [1 * MIN, 30, 0],
        [61 * MIN, 5, 58 * MIN],
      ]),
    ).toEqual([{ from: 0.5 * MIN, to: 61 * MIN - 5_000 }]);
  });

  it("is not fooled by a poller that was merely held back", () => {
    // An hour between readings, no sleep, and the user typing throughout:
    // a throttled window, not an absence.
    expect(
      run([
        [1 * MIN, 3, 0],
        [61 * MIN, 3, 0],
      ]),
    ).toEqual([]);
  });

  it("ignores a sleep blip under a minute", () => {
    expect(
      run([
        [1 * MIN, 3, 0],
        [2 * MIN, 3, 30_000],
      ]),
    ).toEqual([]);
  });

  it("reports one stretch per absence", () => {
    expect(
      run([
        [12 * MIN, 720],
        [13 * MIN, 1],
        [14 * MIN, 2],
        [30 * MIN, 900],
        [31 * MIN, 1],
      ]),
    ).toEqual([
      { from: 0, to: 13 * MIN - 1_000 },
      { from: 15 * MIN, to: 31 * MIN - 1_000 },
    ]);
  });
});
