/**
 * What the Lodging step's cards share: colours, the price grid, and how a price
 * and an early rate are read out of what was typed. One copy, so the Stalls card
 * (`StallsCard.tsx`) and the shavings and camping cards (`LodgingClient.tsx`)
 * cannot disagree about what a blank box or a half-filled early rate means.
 */

export const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

/** The fee row's own limit (`ShowFeeCreate.notes`). Enforced here too, so a
 *  long note stops at the box rather than coming back from the save as a 422. */
export const NOTES_MAX = 500;

/** A stall period's move-in notes' own limit (`StallPeriodIn.move_in_notes`,
 *  migration 199), enforced at the box. */
export const MOVE_IN_NOTES_MAX = 2000;

/** The show's General stalling notes' own limit (`ShowUpdate.stalling_notes`,
 *  migration 207), enforced at the box. */
export const STALLING_NOTES_MAX = 4000;

/** The price column's two tracks: the amount, then whatever sits beside it.
 *  The standard and early amounts share the first, so the two prices line up. */
export const PRICE_COLS = 'grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3';

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** A note is one paragraph, however it was typed or pasted. The box wraps so
 *  the whole note can be read, but the exhibitor's reservation row and the
 *  show bill print it as running text, where a line break typed here would
 *  not be one. */
export function oneParagraph(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, ' ');
}

export type EarlyDraft = {
  earlyDollars: string;
  earlyDeadline: string;
  /** HH:MM on the deadline day, or '' for no hour. */
  earlyDeadlineTime: string;
};

export type EarlyFields = {
  early_amount_cents: number | null;
  early_deadline: string | null;
  early_deadline_time: string | null;
};

/** The early-bird half of a fee payload, or the reason it can't be sent. */
export function earlyFields(draft: EarlyDraft, standardCents: number): EarlyFields | { error: string } {
  const hasAmount = draft.earlyDollars.trim() !== '';
  const hasDeadline = draft.earlyDeadline.trim() !== '';
  if (!hasAmount && !hasDeadline) {
    return { early_amount_cents: null, early_deadline: null, early_deadline_time: null };
  }
  if (hasAmount !== hasDeadline) {
    return {
      error: 'an early rate needs both a discounted amount and a "reserve by" date.',
    };
  }
  const earlyCents = dollarsToCents(draft.earlyDollars);
  if (earlyCents > standardCents) {
    return { error: 'the early rate must be lower than the standard rate.' };
  }
  return {
    early_amount_cents: earlyCents,
    early_deadline: draft.earlyDeadline,
    early_deadline_time: draft.earlyDeadlineTime || null,
  };
}
