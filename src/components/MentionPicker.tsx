import { useEffect, useRef } from "react";
import { JiraUser } from "../api";
import { userSubtitle } from "../mentionInput";

/** The list of people matching what is being typed after an "@".
 *
 *  Owns nothing but its own scrolling: which name is highlighted, and what
 *  choosing one means, both belong to the box being typed into. */
export default function MentionPicker({
  matches,
  active,
  onHover,
  onChoose,
}: {
  matches: JiraUser[];
  /** Index the keyboard is on. */
  active: number;
  onHover: (index: number) => void;
  onChoose: (user: JiraUser) => void;
}) {
  const activeItem = useRef<HTMLLIElement>(null);

  // The list scrolls, so arrowing past its edge has to bring the row along.
  useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ul className="mention-picker" role="listbox">
      {matches.map((user, i) => (
        <li key={user.accountId} ref={i === active ? activeItem : null}>
          <button
            role="option"
            aria-selected={i === active}
            className={`mention-option${i === active ? " active" : ""}`}
            // onMouseDown, not onClick: the textarea would lose focus on blur
            // before a click ever landed.
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(user);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="mention-name">{user.displayName}</span>
            <span className="mention-sub">{userSubtitle(user)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
