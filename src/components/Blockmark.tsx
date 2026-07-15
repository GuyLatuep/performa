// The quarter-square "blockmark" signature: a 2×2 grid of ink / accent cells.
export default function Blockmark({ className = "" }: { className?: string }) {
  return (
    <span className={`blockmark ${className}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
