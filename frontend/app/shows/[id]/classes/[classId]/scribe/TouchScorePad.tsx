'use client';

/**
 * Finger-driven number entry for the scribe screens, docked to the bottom of
 * the viewport while a row is selected.
 *
 * Three layouts rather than one universal keypad, because the three class
 * types want genuinely different things:
 *
 *   placement — a grid of 1..N places. The scribe is copying a judge's card,
 *               so the whole range is visible and one tap assigns.
 *   pattern   — steppers around the current value. Pattern runs start from a
 *               base of 70 and land a few half-points either side, so an empty
 *               field starts at 70 and the common case is one or two taps.
 *   time      — digits. Stepping to 17.842 in increments is not usable.
 *
 * The inputs these drive carry `inputMode="none"` so the OS keyboard never
 * opens over the top of it. Every target is at least 44px.
 */

import { useState } from 'react';

export type PadMode = 'placement' | 'pattern' | 'time';

interface Props {
  mode: PadMode;
  /** Row being edited, e.g. "103 · Emily Stroud". Null hides the pad. */
  subject: string | null;
  value: string;
  onChange: (next: string) => void;
  onNext: () => void;
  onClose: () => void;
  /** placement: highest place available (the active entry count). */
  maxPlace?: number;
  /** placement: places already taken by another row, for the used styling. */
  takenPlaces?: Set<number>;
}

/** Base score every AQHA/APHA pattern run starts from. */
const PATTERN_BASE = 70;

const PAD_BG = '#f5ede0';
const KEY_BG = '#fffdf9';
const KEY_BORDER = '#d4b896';
const INK = '#2c1810';
const MUTED = '#8b7355';

function Key({
  label,
  onClick,
  variant = 'default',
  disabled = false,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'accent' | 'used' | 'ghost';
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: { backgroundColor: KEY_BG, color: INK, borderColor: KEY_BORDER },
    accent: { backgroundColor: INK, color: PAD_BG, borderColor: INK },
    used: { backgroundColor: '#e8ddd0', color: MUTED, borderColor: KEY_BORDER },
    ghost: { backgroundColor: 'transparent', color: MUTED, borderColor: KEY_BORDER },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className="min-h-[52px] min-w-[52px] px-3 rounded-lg border text-lg font-semibold select-none active:scale-95 transition-transform disabled:opacity-40"
      style={styles[variant]}
    >
      {label}
    </button>
  );
}

export default function TouchScorePad({
  mode,
  subject,
  value,
  onChange,
  onNext,
  onClose,
  maxPlace = 0,
  takenPlaces,
}: Props) {
  // Pattern entry is steppers-first — a run is a few half-points either side of
  // 70, so the digit grid is a fallback and stays folded away. Keeping the pad
  // short matters: it is docked over the table the scribe is reading.
  const [showDigits, setShowDigits] = useState(false);

  if (!subject) return null;

  const appendDigit = (d: string) => {
    // Guard against a second decimal point producing "17.8.4".
    if (d === '.' && value.includes('.')) return;
    onChange(value + d);
  };

  const backspace = () => onChange(value.slice(0, -1));

  const step = (delta: number) => {
    const current = value === '' ? PATTERN_BASE : parseFloat(value);
    const base = Number.isNaN(current) ? PATTERN_BASE : current;
    const next = Math.round((base + delta) * 100) / 100;
    onChange(String(next));
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t shadow-lg"
      style={{ backgroundColor: PAD_BG, borderColor: KEY_BORDER }}
    >
      <div className="max-w-3xl mx-auto p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold truncate" style={{ color: INK }}>
            {subject}
            <span className="ml-2 font-mono text-base" style={{ color: '#8b4513' }}>
              {value || '—'}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded hover:underline shrink-0"
            style={{ color: MUTED }}
          >
            Done
          </button>
        </div>

        {mode === 'placement' && (
          <div className="flex flex-wrap gap-2 mb-3">
            {Array.from({ length: maxPlace }, (_, i) => i + 1).map((place) => {
              const isCurrent = value === String(place);
              const isTaken = !isCurrent && takenPlaces?.has(place);
              return (
                <Key
                  key={place}
                  label={String(place)}
                  variant={isCurrent ? 'accent' : isTaken ? 'used' : 'default'}
                  onClick={() => {
                    onChange(String(place));
                    onNext();
                  }}
                  ariaLabel={`Place ${place}${isTaken ? ' (already used)' : ''}`}
                />
              );
            })}
          </div>
        )}

        {mode === 'pattern' && (
          <>
            <div className="flex flex-wrap gap-2 mb-2">
              <Key label="−1" onClick={() => step(-1)} ariaLabel="minus one" />
              <Key label="−0.5" onClick={() => step(-0.5)} ariaLabel="minus half" />
              <Key label="70" onClick={() => onChange(String(PATTERN_BASE))} variant="ghost" />
              <Key label="+0.5" onClick={() => step(0.5)} ariaLabel="plus half" />
              <Key label="+1" onClick={() => step(1)} ariaLabel="plus one" />
              <Key
                label={showDigits ? '×' : '123'}
                onClick={() => setShowDigits((v) => !v)}
                variant="ghost"
                ariaLabel={showDigits ? 'hide keypad' : 'show keypad'}
              />
            </div>
            {showDigits && (
              <div className="grid grid-cols-6 gap-2 mb-3">
                {digits.map((d) => (
                  <Key key={d} label={d} onClick={() => appendDigit(d)} />
                ))}
                <Key label="0" onClick={() => appendDigit('0')} />
                <Key label="." onClick={() => appendDigit('.')} ariaLabel="decimal point" />
                <Key label="⌫" onClick={backspace} variant="ghost" ariaLabel="backspace" />
              </div>
            )}
          </>
        )}

        {mode === 'time' && (
          <div className="grid grid-cols-3 gap-2 mb-3 max-w-xs">
            {digits.map((d) => (
              <Key key={d} label={d} onClick={() => appendDigit(d)} />
            ))}
            <Key label="." onClick={() => appendDigit('.')} ariaLabel="decimal point" />
            <Key label="0" onClick={() => appendDigit('0')} />
            <Key label="⌫" onClick={backspace} variant="ghost" ariaLabel="backspace" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-[44px] px-4 rounded-lg border text-sm font-medium"
            style={{ borderColor: KEY_BORDER, color: MUTED, backgroundColor: KEY_BG }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onNext}
            className="min-h-[44px] px-5 rounded-lg text-sm font-semibold flex-1"
            style={{ backgroundColor: INK, color: PAD_BG }}
          >
            Next horse →
          </button>
        </div>
      </div>
    </div>
  );
}
