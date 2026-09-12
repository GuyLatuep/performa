/** @vitest-environment happy-dom */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { AllKeys } from "./test-support/shortcuts";
import { clearForward, useBackTarget } from "./back";
import { useShortcut } from "./shortcuts";

// Two window listeners share one keydown: `back.ts` answers the navigation
// chords, `shortcuts.ts` the catalogue. Each stands aside from what the other
// claims, and where the two spellings differ by a single modifier only a test
// with both mounted can tell them apart.
//
// ⌘⇧← shipped broken exactly here: `back.ts` matched it as ⌘←, swallowed the
// press and preventDefault'd it, so the dispatcher declined a key that was its
// own. Neither suite alone could see it.

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

/** A screen with a way back and a shifted-arrow shortcut, under both listeners. */
function Screen({
  back,
  prevPeriod,
}: {
  back: () => void;
  prevPeriod: () => void;
}) {
  useBackTarget({ label: "Todo", back });
  const prevKeys = useShortcut("prevPeriod", prevPeriod);
  return (
    <>
      <AllKeys />
      <button {...prevKeys}>Previous</button>
    </>
  );
}

function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  return fireEvent.keyDown(document.body, { key, metaKey: true, ...mods });
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  clearForward();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a shifted arrow against a plain one", () => {
  it("gives ⌘⇧← to the catalogue, not to the navigation layer", () => {
    const back = vi.fn();
    const prevPeriod = vi.fn();
    render(<Screen back={back} prevPeriod={prevPeriod} />);

    press("ArrowLeft", { shiftKey: true });

    expect(prevPeriod).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("still gives ⌘← to the navigation layer", () => {
    const back = vi.fn();
    const prevPeriod = vi.fn();
    render(<Screen back={back} prevPeriod={prevPeriod} />);

    press("ArrowLeft");

    expect(back).toHaveBeenCalledTimes(1);
    expect(prevPeriod).not.toHaveBeenCalled();
  });

  it("gives ⌘[ to the navigation layer too", () => {
    const back = vi.fn();
    render(<Screen back={back} prevPeriod={vi.fn()} />);

    press("[");

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("gives ⌘⇧[ to nobody, it being nobody's chord", () => {
    const back = vi.fn();
    const prevPeriod = vi.fn();
    render(<Screen back={back} prevPeriod={prevPeriod} />);

    // Not swallowed either: an unclaimed press belongs to whoever else wants it.
    expect(press("[", { shiftKey: true })).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(prevPeriod).not.toHaveBeenCalled();
  });
});
