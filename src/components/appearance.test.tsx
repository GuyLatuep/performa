/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import "../test-support/dom";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  getAccent,
  setAccent,
} from "../accent";
import {
  getFunMode,
  getShowIssueTypeIcons,
  setFunMode,
  setShowIssueTypeIcons,
} from "../settings";
import { getTextScale, setTextScale } from "../textScale";
import { getTheme, setTheme } from "../theme";
import AccentPicker from "./AccentPicker";
import Blockmark from "./Blockmark";
import SettingsAppearance from "./SettingsAppearance";
import SettingsFun from "./SettingsFun";
import TextSizeToggle from "./TextSizeToggle";
import ThemeToggle from "./ThemeToggle";

// These are the small settings controls, tested against the *real* stores
// rather than mocks: under happy-dom the stores have a document and a
// localStorage to work with, so what is exercised is the wiring between the
// control and the store — which is the only thing these components do.

beforeEach(() => {
  localStorage.clear();
  // The stores are module-level and outlive a test, so clearing storage alone
  // would leave the previous test's choice in memory. Put each one back to a
  // known value instead.
  setTheme("light");
  setTextScale("normal");
  setAccent(DEFAULT_ACCENT);
  setFunMode(false);
  setShowIssueTypeIcons(true);
});

describe("ThemeToggle", () => {
  it("offers both themes and marks the active one", () => {
    render(<ThemeToggle />);

    expect(
      screen
        .getByRole("button", { name: /Light/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Dark/ }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(getTheme()).toBe("light");
  });

  it("switches the theme and reflects it onto the document", async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));

    expect(getTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: /Dark/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("switches back", async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));
    await userEvent.click(screen.getByRole("button", { name: /Light/ }));

    expect(getTheme()).toBe("light");
  });
});

describe("TextSizeToggle", () => {
  it("offers the three sizes", () => {
    render(<TextSizeToggle />);

    for (const label of ["Normal", "Large", "Larger"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("picks a size and marks it", async () => {
    render(<TextSizeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Larger" }));

    expect(getTextScale()).toBe("larger");
    expect(
      screen
        .getByRole("button", { name: "Larger" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("AccentPicker", () => {
  it("offers every preset", () => {
    render(<AccentPicker />);

    for (const preset of ACCENT_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeDefined();
    }
  });

  it("picks a preset and marks it as pressed", async () => {
    const preset = ACCENT_PRESETS[1];
    render(<AccentPicker />);

    await userEvent.click(screen.getByRole("button", { name: preset.label }));

    expect(getAccent()).toBe(preset.value);
    expect(
      screen
        .getByRole("button", { name: preset.label })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("SettingsFun", () => {
  it("is off by default and turns on", async () => {
    render(<SettingsFun />);
    const box = screen.getByRole("checkbox");
    expect(box).toHaveProperty("checked", false);

    await userEvent.click(box);

    expect(getFunMode()).toBe(true);
    expect(box).toHaveProperty("checked", true);
  });

  it("turns off again", async () => {
    render(<SettingsFun />);
    const box = screen.getByRole("checkbox");

    await userEvent.click(box);
    await userEvent.click(box);

    expect(getFunMode()).toBe(false);
  });
});

describe("SettingsAppearance", () => {
  it("gathers the appearance controls onto one screen", () => {
    render(<SettingsAppearance />);

    expect(screen.getByRole("group", { name: "Appearance" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Accent color" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Text size" })).toBeDefined();
    expect(screen.getByText("Show issue type icons in lists")).toBeDefined();
  });

  it("toggles the issue type icons", async () => {
    render(<SettingsAppearance />);

    await userEvent.click(
      screen.getByLabelText("Show issue type icons in lists"),
    );

    expect(getShowIssueTypeIcons()).toBe(false);
  });

  it("applies a theme change live, without a save step", async () => {
    // The settings shell restores on Cancel, so the preview has to be real.
    render(<SettingsAppearance />);

    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("Blockmark", () => {
  it("is decorative, so it is hidden from assistive technology", () => {
    const { container } = render(<Blockmark />);

    const mark = container.querySelector(".blockmark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelectorAll("i")).toHaveLength(4);
  });

  it("takes an extra class without losing its own", () => {
    const { container } = render(<Blockmark className="big" />);

    expect(container.querySelector(".blockmark.big")).not.toBeNull();
  });
});
