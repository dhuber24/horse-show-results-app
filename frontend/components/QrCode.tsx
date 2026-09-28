'use client';

import { useMemo } from 'react';
import { create } from 'qrcode';

/**
 * A QR code, drawn as an SVG straight from the symbol's module matrix.
 *
 * Drawn here rather than taken as the library's own SVG string because that
 * string carries literal colours, and every colour in this app is a token
 * (`globals.css`). The defaults are the live boards' pair — dark modules on the
 * board's light text colour — because a QR code must be dark on light to scan
 * reliably, whatever the screen around it is.
 *
 * `size` is any CSS length, so a board can scale it with its own units.
 */
export default function QrCode({
  value,
  size,
  label,
  dark = 'var(--slate)',
  light = 'var(--on-slate)',
}: {
  value: string;
  size: string;
  /** Spoken name for the image, e.g. "QR code: this show's results". */
  label: string;
  dark?: string;
  light?: string;
}) {
  const symbol = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    const n = modules.size;
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { d, n };
  }, [value]);

  // The quiet zone the symbol needs around it to be found, in modules. The
  // standard asks for four; three keeps the code larger in the same space and
  // phone cameras find it fine against a solid light tile.
  const quiet = 3;
  const span = symbol.n + quiet * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${span} ${span}`}
      shapeRendering="crispEdges"
      style={{ width: size, height: size, display: 'block' }}
    >
      <rect x={-quiet} y={-quiet} width={span} height={span} fill={light} />
      <path d={symbol.d} fill={dark} />
    </svg>
  );
}
