import type { CSSProperties } from 'react';

/**
 * A placement rosette, in the standard US horse show ribbon colours — blue,
 * red, yellow, white, pink, green — so a placing reads the way it does on the
 * ribbon board at the show office, before anybody reads the number.
 *
 * One component for the class results page and the Live Screens results
 * board, so the two cannot drift into different colours for the same place.
 * It is an SVG on a 32×44 viewBox and scales to whatever box it is given: the
 * results page draws it at 32px, the board at a multiple of its own unit.
 */

const RIBBON_COLORS: Record<number, { main: string; dark: string; text: string }> = {
  1: { main: 'var(--accent)', dark: 'var(--accent-active)', text: 'var(--surface)' },
  2: { main: 'var(--error)', dark: 'var(--error-strong)', text: 'var(--surface)' },
  3: { main: 'var(--warning)', dark: 'var(--warning)', text: 'var(--foreground)' },
  4: { main: 'var(--accent-bg)', dark: 'var(--text-dimmed)', text: 'var(--foreground)' },
  5: { main: 'var(--accent-light)', dark: 'var(--error-strong)', text: 'var(--surface)' },
  6: { main: 'var(--success)', dark: 'var(--success-strong)', text: 'var(--surface)' },
  7: { main: 'var(--accent)', dark: 'var(--accent-active)', text: 'var(--surface)' },
  8: { main: 'var(--warning)', dark: 'var(--warning-strong)', text: 'var(--surface)' },
};

const DEFAULT_RIBBON = { main: 'var(--muted)', dark: 'var(--foreground)', text: 'var(--surface)' };

const RIBBON_CX = 16;
const RIBBON_CY = 16;

/**
 * The scalloped petal ring, computed once.
 *
 * Coordinates are **rounded**, and that is load-bearing rather than tidiness:
 * raw `Math.cos`/`Math.sin` output serializes to a different number of
 * significant digits on the server than in the browser
 * (`27.2583302491977` vs `27.258330249197698`), and the results table is a
 * client component, so React compares the two and logs a hydration mismatch
 * for every rosette on the page. Three decimals is well past visible at 32px.
 */
const RIBBON_PETALS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
  return {
    x: Number((RIBBON_CX + 13 * Math.cos(angle)).toFixed(3)),
    y: Number((RIBBON_CY + 13 * Math.sin(angle)).toFixed(3)),
  };
});

export default function Ribbon({
  place,
  numberSize = 9,
  style,
}: {
  place: number;
  /** The place number's size in viewBox units. The results page prints the
   *  ordinal under the rosette, so 9 is enough there; a board read from across
   *  a room has only the rosette, and passes more. */
  numberSize?: number;
  /** Sizes the rosette. Defaults to the results page's 32×44px. */
  style?: CSSProperties;
}) {
  const { main, dark, text } = RIBBON_COLORS[place] ?? DEFAULT_RIBBON;
  const cx = RIBBON_CX, cy = RIBBON_CY;

  return (
    <svg width="32" height="44" viewBox="0 0 32 44" aria-hidden="true" style={style}>
      <polygon points="10,27 6,44 16,38" fill={dark} />
      <polygon points="22,27 26,44 16,38" fill={dark} />
      {RIBBON_PETALS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={i % 2 === 0 ? main : dark} />
      ))}
      <circle cx={cx} cy={cy} r={10.5} fill={main} />
      <circle cx={cx} cy={cy} r={7.5} fill={dark} />
      <circle cx={cx} cy={cy} r={6} fill={main} />
      <text
        x={cx}
        // Baseline set so the digit's middle sits on the centre whatever size
        // it is drawn at — 3.5 at the original 9 units.
        y={Number((cy + (numberSize * 3.5) / 9).toFixed(2))}
        textAnchor="middle"
        fill={text}
        fontSize={numberSize}
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {place}
      </text>
    </svg>
  );
}
