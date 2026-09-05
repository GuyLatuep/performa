/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { ISSUE_VIEW_NOTICE, TODO_FILTER_NOTICE } from "../notices";
import WhatsNew from "./WhatsNew";

// Tested against the real notices store — it is localStorage plus a set of
// ids, and which notice is owed is exactly what this component is about.

const SEEN_KEY = "performa-notices-seen";

/** Fresh module over a seeded set of already-seen notices. */
async function freshWhatsNew(seen: string[]) {
  localStorage.clear();
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  vi.resetModules();
  const [{ default: Component }, notices] = await Promise.all([
    import("./WhatsNew"),
    import("../notices"),
  ]);
  return { Component, notices };
}

beforeEach(() => {
  localStorage.clear();
});

describe("which notice is shown", () => {
  it("shows the oldest owed notice first, not both at once", async () => {
    // Two modals at once would be a pile.
    const { Component } = await freshWhatsNew([]);

    render(<Component onOpenSettings={vi.fn()} />);

    expect(screen.getByText("The Todo tab now filters itself")).toBeDefined();
    expect(screen.queryByText("Issues now open in the app")).toBeNull();
  });

  it("brings the next one once the first is out of the way", async () => {
    const { Component } = await freshWhatsNew([TODO_FILTER_NOTICE]);

    render(<Component onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Issues now open in the app")).toBeDefined();
  });

  it("shows nothing once every notice has been seen", async () => {
    const { Component } = await freshWhatsNew([
      TODO_FILTER_NOTICE,
      ISSUE_VIEW_NOTICE,
    ]);

    const { container } = render(<Component onOpenSettings={vi.fn()} />);

    expect(container).toHaveProperty("textContent", "");
  });
});

describe("dismissing", () => {
  it("puts the todo notice away and reveals the next", async () => {
    const { Component } = await freshWhatsNew([]);
    render(<Component onOpenSettings={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(screen.queryByText("The Todo tab now filters itself")).toBeNull();
    expect(screen.getByText("Issues now open in the app")).toBeDefined();
  });

  it("opens settings and dismisses in one go", async () => {
    // The explanation should still be on screen behind the settings the user
    // was just told to open — so it is dismissed, not left pending.
    const { Component } = await freshWhatsNew([]);
    const onOpenSettings = vi.fn();
    render(<Component onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole("button", { name: "Set it up" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The Todo tab now filters itself")).toBeNull();
  });

  it("puts the issue-view notice away", async () => {
    const { Component } = await freshWhatsNew([TODO_FILTER_NOTICE]);
    render(<Component onOpenSettings={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(screen.queryByText("Issues now open in the app")).toBeNull();
  });

  it("stays dismissed across a reload", async () => {
    const { Component } = await freshWhatsNew([]);
    render(<Component onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    // What the next launch reads.
    expect(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")).toContain(
      TODO_FILTER_NOTICE,
    );
  });
});

describe("a user who has never stored anything", () => {
  it("is owed every notice", () => {
    // A fresh install, and a user on their first launch after an update, are
    // the same case: nothing seen yet.
    render(<WhatsNew onOpenSettings={vi.fn()} />);

    expect(screen.getByText("The Todo tab now filters itself")).toBeDefined();
  });
});
