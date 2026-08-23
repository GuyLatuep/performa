import { describe, expect, it } from "vitest";
import { commentActions } from "./comments";

describe("commentActions", () => {
  it("offers no visibility choice outside a service desk", () => {
    // There is nothing to choose: the comment is as visible as the issue.
    // Offering "internal" here would promise a privacy that doesn't exist.
    expect(commentActions(false)).toEqual([
      {
        label: "Comment",
        public: true,
        title: "Visible to everyone who can see this issue",
      },
    ]);
  });

  it("offers both kinds on a service-desk issue", () => {
    expect(commentActions(true).map((a) => [a.label, a.public])).toEqual([
      ["Internal note", false],
      ["Reply to customer", true],
    ]);
  });

  it("puts the customer-visible action second", () => {
    // The reply leaves the team; it must not be where muscle memory lands.
    const [first] = commentActions(true);
    expect(first.public).toBe(false);
  });

  it("says who can read the result for every action", () => {
    for (const serviceDesk of [true, false]) {
      for (const action of commentActions(serviceDesk)) {
        expect(action.title).not.toHaveLength(0);
      }
    }
  });
});
