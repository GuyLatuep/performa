/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { isActivatable, overlayOpen, typingIn } from "./keys";

// The listeners that ask these questions are covered in backHook.test.ts and
// konamiHook.test.ts; this file is about the answers themselves.

/** An element in the page, since a detached one is never an event's target. */
function el(tag: string, attrs: Record<string, string> = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  document.body.append(node);
  return node;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("typingIn", () => {
  it.each([
    ["INPUT", "input"],
    ["TEXTAREA", "textarea"],
  ])("is true for an %s", (_label, tag) => {
    expect(typingIn(el(tag))).toBe(true);
  });

  it("is true for a contenteditable", () => {
    const node = el("div");
    node.contentEditable = "true";
    expect(typingIn(node)).toBe(true);
  });

  it("is true for a SELECT, which answers the arrow keys itself", () => {
    // Not in the original tag list. A list watching for ↑/↓ would otherwise
    // move its selection while somebody is choosing an option.
    expect(typingIn(el("select"))).toBe(true);
  });

  it.each([
    ["a button", "button"],
    ["a div", "div"],
    ["the body", "body"],
  ])("is false for %s", (_label, tag) => {
    expect(typingIn(tag === "body" ? document.body : el(tag))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(typingIn(null)).toBe(false);
  });
});

describe("isActivatable", () => {
  it.each([
    ["a button", "button"],
    ["a link", "a"],
    ["an input", "input"],
    ["a select", "select"],
    ["a textarea", "textarea"],
    ["a summary", "summary"],
  ])("is true for %s, which answers Enter on its own", (_label, tag) => {
    expect(isActivatable(el(tag))).toBe(true);
  });

  it.each([
    ["a div", "div"],
    ["a list item", "li"],
    ["a span", "span"],
  ])("is false for %s", (_label, tag) => {
    expect(isActivatable(el(tag))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isActivatable(null)).toBe(false);
  });
});

describe("overlayOpen", () => {
  it("is false with nothing over the page", () => {
    expect(overlayOpen()).toBe(false);
  });

  it("is true for a modal", () => {
    el("div", { class: "modal-backdrop" });
    expect(overlayOpen()).toBe(true);
  });

  it("is true for a dialog popover, which has no backdrop of its own", () => {
    el("div", { role: "dialog" });
    expect(overlayOpen()).toBe(true);
  });

  it("is false again once it closes", () => {
    el("div", { class: "modal-backdrop" }).remove();
    expect(overlayOpen()).toBe(false);
  });
});
