/** @vitest-environment happy-dom */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import {
  ActionId,
  boundShortcuts,
  useShortcut,
  useShortcutBadge,
  useShortcutKeys,
} from "./shortcuts";

// The catalogue and its predicates are covered in shortcuts.test.ts; this file
// is the registry and the one listener over it.
//
// Controls are rendered rather than having their ref called by hand: the binding
// is attached and released by React, which is the mechanism the registry rests
// on — a ref cleanup is the only moment at which *which* node went away is
// known.

/** A control carrying a shortcut, with the dispatcher mounted above it. */
function Probe({
  id = "tabTodo" as ActionId,
  run,
  enabled = true,
  inModal = false,
}: {
  id?: ActionId;
  run: () => void;
  enabled?: boolean;
  inModal?: boolean;
}) {
  const props = useShortcut(id, run, enabled);
  useShortcutKeys();
  const button = <button {...props}>control</button>;
  return inModal ? <div className="modal-backdrop">{button}</div> : button;
}

/** Press a chord at `target`, so it bubbles to the window listener with the
 *  target a real element — which is what the draft guard reads. Returns false
 *  when something called `preventDefault`. */
function press(
  key: string,
  target: Element = document.body,
  mods: Partial<KeyboardEventInit> = {},
) {
  return fireEvent.keyDown(target, { key, metaKey: true, ...mods });
}

/** A focused field holding text, i.e. an unsaved draft. */
function draft(text = "half a comment") {
  const el = document.createElement("textarea");
  document.body.append(el);
  el.value = text;
  el.focus();
  return el;
}

/** Put an overlay in the page, the way every modal does. */
function overlay() {
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  document.body.append(el);
  return el;
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a bound shortcut", () => {
  it("runs its handler on the chord", () => {
    const run = vi.fn();
    render(<Probe run={run} />);

    press("2");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs it wherever the press lands, being a window listener", () => {
    const run = vi.fn();
    render(<Probe run={run} />);
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);

    press("2", elsewhere);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("claims the press, so nothing else also acts on it", () => {
    render(<Probe run={vi.fn()} />);

    expect(press("2")).toBe(false);
  });

  it("calls the newest handler after a re-render", () => {
    // The closure is new every render; re-binding the node for that would have
    // React detach and re-attach it each time.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe run={first} />);

    rerender(<Probe run={second} />);
    press("2");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("tells a screen reader its chord", () => {
    const { getByRole } = render(<Probe run={vi.fn()} />);

    expect(getByRole("button").getAttribute("aria-keyshortcuts")).toBe(
      "Meta+2",
    );
  });
});

describe("an unbound shortcut", () => {
  it("does nothing, and leaves the press alone", () => {
    // No control on screen for it, so the key is not ours to swallow.
    render(<Probe id="settings" run={vi.fn()} />);

    expect(press("2")).toBe(true);
  });

  it("is not registered while disabled", () => {
    const run = vi.fn();
    render(<Probe run={run} enabled={false} />);

    press("2");

    expect(run).not.toHaveBeenCalled();
    expect(boundShortcuts()).toEqual([]);
  });

  it("is gone once the control unmounts", () => {
    const run = vi.fn();
    const { unmount } = render(<Probe run={run} />);

    unmount();
    press("2");

    expect(run).not.toHaveBeenCalled();
    expect(boundShortcuts()).toEqual([]);
  });

  it("goes away when the control is merely disabled", () => {
    const run = vi.fn();
    const { rerender } = render(<Probe run={run} />);

    rerender(<Probe run={run} enabled={false} />);
    press("2");

    expect(run).not.toHaveBeenCalled();
  });

  it("leaves the slot to whoever took it, however the commits interleave", () => {
    // React commits every cleanup before every setup, so a screen replacing
    // another sees the outgoing control's cleanup run after the incoming one
    // has claimed the id. The same guard, for the same reason, as back.ts.
    const outgoing = vi.fn();
    const incoming = vi.fn();
    const first = render(<Probe run={outgoing} />);
    render(<Probe run={incoming} />);

    first.unmount();
    press("2");

    expect(incoming).toHaveBeenCalledTimes(1);
  });
});

describe("two controls for one action", () => {
  // A modal's Submit opens over the form's Submit underneath it, and the page's
  // button stays mounted throughout. The innermost one answers, and the outer
  // one must come back when it closes.

  function Stacked({
    inner,
    outer,
    modalOpen,
  }: {
    inner: () => void;
    outer: () => void;
    modalOpen: boolean;
  }) {
    return (
      <>
        <Probe run={outer} />
        {modalOpen && <Probe run={inner} />}
      </>
    );
  }

  it("lets the innermost one answer", () => {
    const inner = vi.fn();
    const outer = vi.fn();
    render(<Stacked inner={inner} outer={outer} modalOpen />);

    press("2");

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("gives the action back when the inner one closes", () => {
    // The bug a single slot would have: the modal overwrites the page's binding
    // and deletes it on the way out, leaving the chord bound to nothing while a
    // perfectly good button is still on screen.
    const inner = vi.fn();
    const outer = vi.fn();
    const { rerender } = render(
      <Stacked inner={inner} outer={outer} modalOpen />,
    );

    rerender(<Stacked inner={inner} outer={outer} modalOpen={false} />);
    press("2");

    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(0);
  });

  it("reports only the one that answers", () => {
    const { rerender } = render(
      <Stacked inner={vi.fn()} outer={vi.fn()} modalOpen />,
    );

    expect(boundShortcuts()).toHaveLength(1);

    rerender(<Stacked inner={vi.fn()} outer={vi.fn()} modalOpen={false} />);

    expect(boundShortcuts()).toHaveLength(1);
  });
});

describe("a chord somebody else answers", () => {
  /** A Back button: badged here, run by `back.ts`. */
  function Badged() {
    const props = useShortcutBadge("back");
    useShortcutKeys();
    return <button {...props}>Back</button>;
  }

  it("is registered, so its badge can be placed", () => {
    render(<Badged />);

    expect(boundShortcuts().map((b) => b.id)).toEqual(["back"]);
  });

  it("carries no handler, so this dispatcher runs nothing", () => {
    render(<Badged />);

    // Left entirely alone — `back.ts`'s own listener is what acts on it, and
    // swallowing the press here would stop it ever getting there.
    expect(press("[")).toBe(true);
  });

  it("still tells a screen reader its chord", () => {
    const { getByRole } = render(<Badged />);

    expect(getByRole("button").getAttribute("aria-keyshortcuts")).toBe(
      "Meta+[",
    );
  });
});

describe("the guards", () => {
  it("stands aside for a press something nearer already claimed", () => {
    const run = vi.fn();
    render(<Probe run={run} />);
    const picker = document.createElement("div");
    document.body.append(picker);
    picker.addEventListener("keydown", (e) => e.preventDefault());

    press("2", picker);

    expect(run).not.toHaveBeenCalled();
  });

  it("fires while typing, because a ⌘-chord is not typing", () => {
    // The whole departure from back.ts's blanket guard: an empty box holds
    // nothing to lose, so nothing stands down.
    const run = vi.fn();
    render(<Probe run={run} />);
    const box = draft("");

    press("2", box);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stands down over an unsaved draft, and lets the press through", () => {
    const run = vi.fn();
    render(<Probe run={run} />);
    const box = draft();

    expect(press("2", box)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not fire for a control behind a modal", () => {
    const run = vi.fn();
    render(<Probe run={run} />);
    overlay();

    press("2");

    expect(run).not.toHaveBeenCalled();
  });

  it("does fire for a control inside one", () => {
    // A modal's own controls are available; it is the page behind that is not.
    const run = vi.fn();
    render(<Probe run={run} inModal />);

    press("2");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the dispatcher unmounts", () => {
    const run = vi.fn();
    const { unmount } = render(<Probe run={run} />);

    unmount();
    press("2");

    expect(run).not.toHaveBeenCalled();
  });
});
