/**
 * How a horse's coat reads on its registration papers.
 *
 * Colour and pattern are two independent axes (migration 116) and a Paint has
 * both — a certificate says "Bay Tobiano", not one or the other. They shared a
 * single lookup list until 116, so whoever entered the horse had to pick which
 * half to record; rendering only `color_name` now would throw away the half that
 * identifies the horse across a warm-up pen.
 *
 * Returns null when neither is set, so callers can keep using it as a guard.
 */
export function coatDescription(
  colorName?: string | null,
  patternName?: string | null,
): string | null {
  return [colorName, patternName].filter(Boolean).join(' ') || null;
}
