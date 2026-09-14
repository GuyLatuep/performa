/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import About from "./About";

const openUrl = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.3" }));

describe("About", () => {
  it("opens a mail composer on the author's address", async () => {
    render(<About onClose={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "malte@polz.in" }),
    );
    // `mailto:` is not `https:`, so the opener scope in
    // capabilities/default.json has to name the scheme for this to reach the
    // desktop at all.
    expect(openUrl).toHaveBeenCalledWith("mailto:malte@polz.in");
  });

  it("goes back", async () => {
    const onClose = vi.fn();
    render(<About onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(onClose).toHaveBeenCalled();
  });
});
