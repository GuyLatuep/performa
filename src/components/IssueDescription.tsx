import { useLayoutEffect, useRef, useState } from "react";

/** The issue's description, clamped to a few lines with a way to open it.
 *
 *  Measured rather than guessed at: whether a description overflows depends on
 *  the window width and the text, so a character count would put "Show more"
 *  on a two-line description and hide a long one. The toggle only appears when
 *  there is genuinely more to see. */
export default function IssueDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      // Only meaningful while clamped; expanded, the two are equal by
      // definition.
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    if (!expanded) check();
    // The clamp is a line count, so a resize changes what fits.
    const observer = new ResizeObserver(() => {
      if (!expanded) check();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p
        ref={ref}
        className={`issue-description${expanded ? " expanded" : ""}`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button className="link" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less ▲" : "Show more ▼"}
        </button>
      )}
    </>
  );
}
