/**
 * The dotted run between a line's label and its figure, as on a printed bill,
 * so the eye can follow a short label across to a quantity or an amount at the
 * far side of a wide row.
 *
 * Goes between the two in a row laid out `flex items-baseline`: it has no
 * height, so its baseline is its bottom edge and the dots sit on the text's
 * baseline rather than floating mid-row.
 */
export default function DotLeader() {
  return (
    <span
      aria-hidden
      className="flex-1 min-w-[1.5rem] h-0 border-b-2 border-dotted"
      style={{ borderColor: 'var(--border)' }}
    />
  );
}
