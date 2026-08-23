import { forwardRef } from "react";
import { highlightSegments, PickedMention } from "../mentionInput";

/** A marked-up copy of the comment, painted behind a textarea whose own text
 *  is transparent.
 *
 *  A textarea cannot style a range of its own value, and this is the least bad
 *  way around that. The two layers must share every metric that decides where
 *  a glyph lands — font, line height, padding, border, wrapping — or the marks
 *  drift off the words they belong to; that pairing lives in the stylesheet,
 *  under `.comment-compose`.
 *
 *  Takes a ref because the caller syncs its scroll position to the textarea's. */
const CommentMirror = forwardRef<
  HTMLDivElement,
  { text: string; picked: PickedMention[] }
>(function CommentMirror({ text, picked }, ref) {
  return (
    <div className="comment-mirror" aria-hidden="true" ref={ref}>
      {highlightSegments(text, picked).map((segment, i) =>
        segment.accountId ? (
          <mark key={i} className="mention-mark">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
      {/* A trailing newline has no height of its own; without this the mirror
          stops scrolling one line before the textarea does. */}
      {"\n"}
    </div>
  );
});

export default CommentMirror;
