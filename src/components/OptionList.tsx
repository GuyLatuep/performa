import { useEffect, useRef } from "react";

/** One row: what it says, and what tells two rows with the same name apart. */
export interface Option {
  key: string;
  name: string;
  sub: string;
}

/** The matches under a search box, one of them highlighted.
 *
 *  Owns nothing but its own scrolling: which row is highlighted, and what
 *  choosing one means, both belong to the box being typed into — see
 *  `typeaheadKey`. */
export default function OptionList({
  options,
  active,
  onHover,
  onChoose,
}: {
  options: Option[];
  /** Index the keyboard is on. */
  active: number;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}) {
  const activeItem = useRef<HTMLLIElement>(null);

  // The list scrolls, so arrowing past its edge has to bring the row along.
  useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ul className="mention-picker" role="listbox">
      {options.map((option, i) => (
        <li key={option.key} ref={i === active ? activeItem : null}>
          <button
            role="option"
            aria-selected={i === active}
            className={`mention-option${i === active ? " active" : ""}`}
            // onMouseDown, not onClick: the box being typed into would lose
            // focus on blur before a click ever landed.
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(i);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="mention-name">{option.name}</span>
            <span className="mention-sub">{option.sub}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
