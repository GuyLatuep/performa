import { beforeEach, describe, expect, it, vi } from "vitest";

// fun.ts builds `Audio` elements, which node does not have. The stub records
// every element made so the tests can check both what played and how often one
// was constructed — reuse is the whole point of the player cache.
const audio = vi.hoisted(() => {
  const made: {
    src: string;
    volume: number;
    currentTime: number;
    play: ReturnType<typeof vi.fn>;
  }[] = [];
  class FakeAudio {
    src: string;
    volume = 1;
    currentTime = 1;
    play = vi.fn(() => Promise.resolve());
    constructor(src: string) {
      this.src = src;
      made.push(this);
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
  return { made };
});

// Hoisted so the same mock survives the `resetModules` below — a factory
// returning a fresh `vi.fn` each time would leave the tests holding a stale one.
const settings = vi.hoisted(() => ({ getFunMode: vi.fn(() => true) }));
vi.mock("./settings", () => settings);

/** Fresh module, so the player cache starts empty — it is module-level state,
 *  and reuse across calls is one of the things under test here. */
async function freshFun() {
  audio.made.length = 0;
  vi.resetModules();
  return import("./fun");
}

beforeEach(() => {
  settings.getFunMode.mockReturnValue(true);
});

describe("with fun mode off", () => {
  it("plays nothing at all", async () => {
    // Checked inside fun.ts rather than at each call site: a caller says "a
    // worklog landed" without knowing whether the app is in a mood to
    // celebrate.
    settings.getFunMode.mockReturnValue(false);
    const { playCheer, playMessage, playFanfare } = await freshFun();

    playCheer();
    playMessage();
    playFanfare();

    expect(audio.made).toHaveLength(0);
  });
});

describe("with fun mode on", () => {
  it("plays the cheer for a filed worklog", async () => {
    const { playCheer } = await freshFun();

    playCheer();

    expect(audio.made).toHaveLength(1);
    expect(audio.made[0].play).toHaveBeenCalled();
  });

  it("plays the arrival sound quieter than the cheer", async () => {
    // The cheer answers something the user just did; a mention arrives
    // unbidden and should not be as loud.
    const { playCheer, playMessage } = await freshFun();

    playCheer();
    playMessage();

    const [cheer, message] = audio.made;
    expect(message.volume).toBeLessThan(cheer.volume);
  });

  it("reuses one element per sound rather than piling them up", async () => {
    const { playCheer } = await freshFun();

    playCheer();
    playCheer();
    playCheer();

    expect(audio.made).toHaveLength(1);
    expect(audio.made[0].play).toHaveBeenCalledTimes(3);
  });

  it("rewinds before replaying, so two in a row sound twice", async () => {
    const { playCheer } = await freshFun();

    playCheer();
    audio.made[0].currentTime = 5;
    playCheer();

    expect(audio.made[0].currentTime).toBe(0);
  });

  it("keeps a separate element for each different sound", async () => {
    const { playCheer, playMessage } = await freshFun();

    playCheer();
    playMessage();

    expect(audio.made).toHaveLength(2);
    expect(audio.made[0].src).not.toBe(audio.made[1].src);
  });

  it("plays the fanfare louder than the ordinary cheer", async () => {
    // The rare one, every tenth worklog — it should land as an occasion.
    //
    // The `else playCheer()` fallback beside it is deliberately *not* tested:
    // `fanfareUrl` comes from an eager `import.meta.glob`, resolved at build
    // time, and the file is present in this repo — so that branch cannot be
    // reached from a test without deleting the asset. It exists so the build
    // works for someone who has not dropped the file in.
    const { playCheer, playFanfare } = await freshFun();

    playCheer();
    playFanfare();

    const [cheer, fanfare] = audio.made;
    expect(fanfare.src).not.toBe(cheer.src);
    expect(fanfare.volume).toBeGreaterThan(cheer.volume);
    expect(fanfare.play).toHaveBeenCalled();
  });

  it("survives a browser that refuses to play", async () => {
    // No output device, an autoplay policy, a codec it dislikes — none of it
    // is allowed to take the worklog down with it.
    const { playCheer } = await freshFun();

    playCheer();
    audio.made[0].play.mockReturnValueOnce(
      Promise.reject(new Error("no audio device")),
    );

    expect(() => playCheer()).not.toThrow();
  });
});
