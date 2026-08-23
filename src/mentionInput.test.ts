import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  applyMention,
  deleteMentionBefore,
  highlightSegments,
  PickedMention,
  usedMentions,
  userSubtitle,
} from "./mentionInput";
import { JiraUser } from "./api";

function user(over: Partial<JiraUser> = {}): JiraUser {
  return {
    accountId: "acc-1",
    displayName: "Malte Polzin",
    ...over,
  };
}

/** What the box remembers after a pick: the account, and the characters
 *  standing in for it. */
function pick(over: Partial<PickedMention> = {}): PickedMention {
  return { accountId: "acc-1", name: "Malte Polzin", ...over };
}

describe("activeMentionQuery", () => {
  it("is the text typed since the @", () => {
    const text = "Hi @Mal";
    expect(activeMentionQuery(text, text.length)).toBe("Mal");
  });

  it("opens on a bare @ so the picker appears at once", () => {
    expect(activeMentionQuery("Hi @", 4)).toBe("");
  });

  it("keeps going across a space, because names have spaces", () => {
    const text = "Hi @Malte P";
    expect(activeMentionQuery(text, text.length)).toBe("Malte P");
  });

  it("ignores an @ that isn't at a word boundary", () => {
    // Otherwise every email address opens the picker mid-word.
    const text = "mail malte@polz.in";
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });

  it("stops at a newline", () => {
    const text = "@Malte\nnext line";
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });

  it("gives up once the fragment is too long to be a name", () => {
    const text = `@${"x".repeat(41)}`;
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });

  it("is null when there is no @ before the caret", () => {
    expect(activeMentionQuery("no mention here", 15)).toBeNull();
    // An @ *after* the caret is not what is being typed.
    expect(activeMentionQuery("abc @Malte", 3)).toBeNull();
  });

  it("reads from the caret, not the end of the text", () => {
    const text = "Hi @Mal and more";
    expect(activeMentionQuery(text, 7)).toBe("Mal");
  });

  it("closes once the name has been chosen", () => {
    // The text a pick leaves behind would otherwise read as a name still being
    // typed, reopening the picker over a finished mention.
    const text = "Hi @Malte Polzin ";
    expect(activeMentionQuery(text, text.length, [pick()])).toBeNull();
  });

  it("stays closed with the caret right after the name, before the space", () => {
    const text = "Hi @Malte Polzin";
    expect(activeMentionQuery(text, text.length, [pick()])).toBeNull();
  });

  it("still opens for the next mention after a finished one", () => {
    const text = "Hi @Malte Polzin and @Ann";
    expect(activeMentionQuery(text, text.length, [pick()])).toBe("Ann");
  });

  it("reopens once the writer types on past the chosen name", () => {
    // No longer sitting on the mention, so this is a new fragment.
    const text = "Hi @Malte Polzin x";
    expect(activeMentionQuery(text, text.length, [pick()])).toBe(
      "Malte Polzin x",
    );
  });

  it("is unaffected by picks that aren't at the caret", () => {
    const text = "Hi @Mal";
    expect(activeMentionQuery(text, text.length, [pick()])).toBe("Mal");
  });
});

describe("applyMention", () => {
  it("replaces the fragment with the full name and a space", () => {
    const text = "Hi @Mal";
    const out = applyMention(text, text.length, user());
    expect(out.text).toBe("Hi @Malte Polzin ");
    expect(out.caret).toBe(out.text.length);
  });

  it("keeps what follows the caret", () => {
    const text = "Hi @Mal, look";
    const out = applyMention(text, 7, user());
    expect(out.text).toBe("Hi @Malte Polzin , look");
  });

  it("leaves the caret ready for the next word", () => {
    const text = "Hi @Mal, look";
    const out = applyMention(text, 7, user());
    expect(out.text.slice(0, out.caret)).toBe("Hi @Malte Polzin ");
  });

  it("does nothing when there is no @ to replace", () => {
    expect(applyMention("plain", 5, user())).toEqual({
      text: "plain",
      caret: 5,
    });
  });
});

describe("usedMentions", () => {
  it("keeps a pick whose name is still written", () => {
    expect(usedMentions("Hi @Malte Polzin", [pick()])).toHaveLength(1);
  });

  it("drops a pick the writer deleted again", () => {
    // Notifying somebody whose name was removed is the worst outcome here.
    expect(usedMentions("Hi there", [pick()])).toEqual([]);
  });

  it("counts one person once however often they were picked", () => {
    expect(
      usedMentions("@Malte Polzin @Malte Polzin", [pick(), pick()]),
    ).toHaveLength(1);
  });

  it("keeps two different people", () => {
    const picks = [pick(), pick({ accountId: "acc-2", name: "Anna Leeson" })];
    expect(usedMentions("@Malte Polzin and @Anna Leeson", picks)).toHaveLength(
      2,
    );
  });

  it("is empty when nothing was picked", () => {
    expect(usedMentions("@Someone", [])).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("marks a picked name and leaves the rest plain", () => {
    expect(highlightSegments("Hi @Malte Polzin, look", [pick()])).toEqual([
      { text: "Hi " },
      { text: "@Malte Polzin", accountId: "acc-1" },
      { text: ", look" },
    ]);
  });

  it("leaves an @ nobody picked as plain text", () => {
    // What is marked must be exactly what becomes a mention.
    expect(highlightSegments("mail malte@polz.in", [])).toEqual([
      { text: "mail malte@polz.in" },
    ]);
  });

  it("prefers the longest name, as the Rust side does", () => {
    const picks = [
      pick({ accountId: "short", name: "Anna" }),
      pick({ accountId: "long", name: "Anna Leeson" }),
    ];
    expect(highlightSegments("@Anna Leeson ping", picks)).toEqual([
      { text: "@Anna Leeson", accountId: "long" },
      { text: " ping" },
    ]);
  });

  it("marks several mentions on one line", () => {
    const picks = [
      pick({ accountId: "a", name: "A" }),
      pick({ accountId: "b", name: "B" }),
    ];
    expect(
      highlightSegments("@A and @B", picks)
        .filter((s) => s.accountId)
        .map((s) => s.accountId),
    ).toEqual(["a", "b"]);
  });

  it("handles a mention at either end", () => {
    expect(highlightSegments("@Malte Polzin", [pick()])).toEqual([
      { text: "@Malte Polzin", accountId: "acc-1" },
    ]);
  });

  it("is empty for empty text", () => {
    expect(highlightSegments("", [pick()])).toEqual([]);
  });
});

describe("deleteMentionBefore", () => {
  it("removes the whole name in one go", () => {
    const text = "Hi @Malte Polzin ";
    expect(deleteMentionBefore(text, text.length, [pick()])).toEqual({
      text: "Hi ",
      caret: 3,
    });
  });

  it("takes the space the pick added with it", () => {
    // That space was inserted, not typed, so it should not be left behind.
    const text = "@Malte Polzin ";
    expect(deleteMentionBefore(text, text.length, [pick()])?.text).toBe("");
  });

  it("works when the mention has no trailing space", () => {
    const text = "Hi @Malte Polzin";
    expect(deleteMentionBefore(text, text.length, [pick()])?.text).toBe("Hi ");
  });

  it("declines when the caret is not just after a mention", () => {
    // Ordinary backspace should happen instead.
    expect(deleteMentionBefore("Hi there", 8, [pick()])).toBeNull();
    expect(deleteMentionBefore("Hi @Malte Polzin!", 17, [pick()])).toBeNull();
  });

  it("declines mid-name, so a caret inside one still edits normally", () => {
    const text = "Hi @Malte Polzin";
    expect(deleteMentionBefore(text, 9, [pick()])).toBeNull();
  });

  it("keeps text after the caret", () => {
    const text = "@Malte Polzin please look";
    // Caret right after the inserted space.
    expect(deleteMentionBefore(text, 14, [pick()])).toEqual({
      text: "please look",
      caret: 0,
    });
  });

  it("declines when nothing was picked", () => {
    expect(deleteMentionBefore("@Malte Polzin ", 14, [])).toBeNull();
  });
});

describe("userSubtitle", () => {
  it("prefers the email, which is what tells two namesakes apart", () => {
    expect(userSubtitle(user({ email: "malte@polz.in" }))).toBe(
      "malte@polz.in",
    );
  });

  it("falls back to the account id when the site hides emails", () => {
    expect(userSubtitle(user())).toBe("acc-1");
  });
});
