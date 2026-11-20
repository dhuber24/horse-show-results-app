'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { timeForDay } from '@/lib/default-time';
import { COLORS, NOTES_MAX, centsToDollars, dollarsToCents, earlyFields, oneParagraph } from './fields';

/**
 * A Lodging step card that sells a list of options the office names itself,
 * each one reservable `show_fees` row: *Camping & hook-ups* (`lib/camping.ts`)
 * — WSCA's full-show, Wednesday-to-Friday and Friday-to-Monday electrical, each
 * at its own price — and *Parking & permits* (`lib/permits.ts`) — a parking
 * permit, a side-by-side, an additional vehicle. Each option has a name, a
 * price, how it is charged, an optional early rate, and notes; exhibitors book
 * how many they need at sign-up.
 *
 * A row's code is given from its name when it is first saved (`config.codeFor`)
 * and kept after, so renaming an option never makes a second one. The state
 * lives in `useOptionListEditor` so `LodgingClient` can fold it into the step's
 * one save and one dirty check, as it does the Stalls card.
 */

export type OptionFeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  early_deadline_time?: string | null;
  reserved_count?: number;
};

export type OptionUnit = {
  value: string;
  /** How the office picks it. */
  choice: string;
  /** What one booked counts, for "$ per …". */
  noun: string;
};

export type OptionListConfig = {
  id: string;
  heading: string;
  blurb: string;
  /** Whether a fee row is one of this card's. */
  belongs: (fee: { code: string }) => boolean;
  /** The first is a new option's default. */
  units: readonly OptionUnit[];
  /** A new option's code from its name, unique among `taken`. */
  codeFor: (label: string, taken: ReadonlySet<string>) => string;
  /** Whether an option may carry an early rate. */
  early: boolean;
  /** "camping option", "permit": what the add button adds. */
  noun: string;
  namePlaceholder: string;
  pricePlaceholder: string;
  notesPlaceholder: string;
  /** A named option offered by its own button while no option matches it —
   *  "+ Add a parking permit". */
  starter?: { label: string; button: string; matches: RegExp };
};

type OptionDraft = {
  /** Stable for React: the fee's id, or a made-up one until it is saved. */
  key: string;
  feeId: string | null;
  label: string;
  dollars: string;
  unit: string;
  notes: string;
  earlyDollars: string;
  earlyDeadline: string;
  earlyDeadlineTime: string;
  reservedCount: number;
};

function fromFee(fee: OptionFeeRow): OptionDraft {
  return {
    key: fee.id,
    feeId: fee.id,
    label: fee.label,
    dollars: centsToDollars(fee.amount_cents),
    unit: fee.unit,
    notes: fee.notes ?? '',
    earlyDollars: fee.early_amount_cents != null ? centsToDollars(fee.early_amount_cents) : '',
    earlyDeadline: fee.early_deadline ?? '',
    earlyDeadlineTime: (fee.early_deadline_time ?? '').slice(0, 5),
    reservedCount: fee.reserved_count ?? 0,
  };
}

let nextKey = 0;

export function useOptionListEditor(
  config: OptionListConfig,
  {
    showId,
    fees,
    takenCodes,
  }: {
    showId: string;
    /** The step's fees; the ones `config.belongs` claims are this card's. */
    fees: readonly OptionFeeRow[];
    /** Every fee code on the show, so a new option's code is unique. */
    takenCodes: readonly string[];
  },
) {
  const onFile = fees.filter(config.belongs);
  const [drafts, setDrafts] = useState<OptionDraft[]>(() => onFile.map(fromFee));
  // Options on file that were removed on screen, to delete on save.
  const [removed, setRemoved] = useState<OptionDraft[]>([]);

  const feeOf = (id: string | null) => (id ? onFile.find((f) => f.id === id) : undefined);

  function add(label = '') {
    nextKey += 1;
    const draft: OptionDraft = {
      key: `new-${config.id}-${nextKey}`,
      feeId: null,
      label,
      dollars: '',
      unit: config.units[0].value,
      notes: '',
      earlyDollars: '',
      earlyDeadline: '',
      earlyDeadlineTime: '',
      reservedCount: 0,
    };
    setDrafts((prev) => [...prev, draft]);
  }

  function update(key: string, patch: Partial<OptionDraft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function remove(key: string) {
    const draft = drafts.find((d) => d.key === key);
    if (draft?.feeId) setRemoved((prev) => [...prev, draft]);
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function draftDirty(d: OptionDraft): boolean {
    if (!d.feeId) return Boolean(d.label.trim() || d.dollars.trim() || d.notes.trim() || d.earlyDollars.trim());
    const fee = feeOf(d.feeId);
    // Saved this session and not yet back from the refresh: nothing to compare.
    if (!fee) return false;
    return (
      d.label.trim() !== fee.label ||
      d.dollars.trim() !== centsToDollars(fee.amount_cents) ||
      d.unit !== fee.unit ||
      d.notes.trim() !== (fee.notes ?? '').trim() ||
      d.earlyDollars.trim() !== (fee.early_amount_cents != null ? centsToDollars(fee.early_amount_cents) : '') ||
      d.earlyDeadline !== (fee.early_deadline ?? '') ||
      d.earlyDeadlineTime !== (fee.early_deadline_time ?? '').slice(0, 5)
    );
  }

  const dirty = removed.length > 0 || drafts.some(draftDirty);

  /** Writes the card. Returns whether everything was written; a failure has
   *  said why through `onError`. */
  async function save(onError: (message: string) => void): Promise<boolean> {
    // Everything is checked before anything is written.
    const payloads = new Map<string, Record<string, unknown>>();
    for (const d of drafts) {
      if (!draftDirty(d)) continue;
      if (!d.label.trim()) {
        onError(`${config.heading}: every ${config.noun} needs a name, or remove it.`);
        return false;
      }
      const name = d.label.trim();
      const price = Number.parseFloat(d.dollars);
      if (d.dollars.trim() === '' || !Number.isFinite(price) || price < 0) {
        onError(`${name}: enter its price, or remove it.`);
        return false;
      }
      const cents = dollarsToCents(d.dollars);
      const early = config.early
        ? earlyFields(d, cents)
        : { early_amount_cents: null, early_deadline: null, early_deadline_time: null };
      if ('error' in early) {
        onError(`${name}: ${early.error}`);
        return false;
      }
      payloads.set(d.key, { label: name, amount_cents: cents, notes: d.notes.trim() || null, ...early });
    }

    for (const d of removed) {
      const res = await fetch(`/api/shows/${showId}/fees/${d.feeId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        const json = await res.json().catch(() => null);
        onError(errorMessage(json, `Failed to remove ${d.label}.`));
        return false;
      }
    }
    setRemoved([]);

    // The codes on the show once the removals are gone, so a removed
    // `camping` can be taken again by the option that replaces it.
    const gone = new Set(removed.map((d) => feeOf(d.feeId)?.code).filter(Boolean));
    const used = new Set(takenCodes.filter((c) => !gone.has(c)));
    const settled: Record<string, string> = {};
    for (const d of drafts) {
      const payload = payloads.get(d.key);
      if (!payload) continue;
      if (d.feeId) {
        const fee = feeOf(d.feeId);
        const res = await fetch(`/api/shows/${showId}/fees/${d.feeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, ...(fee && d.unit !== fee.unit ? { unit: d.unit } : {}) }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          onError(errorMessage(json, `Failed to update ${d.label}.`));
          return false;
        }
      } else {
        const code = config.codeFor(d.label, used);
        used.add(code);
        const res = await fetch(`/api/shows/${showId}/fees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, code, unit: d.unit }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.id) {
          onError(errorMessage(json, `Failed to add ${d.label}.`));
          return false;
        }
        settled[d.key] = json.id;
      }
    }
    // Remember what was created, so a second save from this screen patches
    // the row the first one made instead of posting another.
    setDrafts((prev) => prev.map((d) => (settled[d.key] ? { ...d, feeId: settled[d.key] } : d)));
    return true;
  }

  return { config, drafts, removed, add, update, remove, dirty, save };
}

export type OptionListEditor = ReturnType<typeof useOptionListEditor>;

const INPUT = 'w-full border rounded px-3 py-2';
const LABEL = 'block text-xs mb-1';

export function OptionListCard({ editor }: { editor: OptionListEditor }) {
  const { config, drafts, removed } = editor;
  const removedBooked = removed.filter((d) => d.reservedCount > 0);
  const starter = config.starter && !drafts.some((d) => config.starter!.matches.test(d.label)) ? config.starter : null;
  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      aria-labelledby={`${config.id}-heading`}
    >
      <div>
        <h2 id={`${config.id}-heading`} className="text-base font-semibold" style={{ color: COLORS.text }}>
          {config.heading}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
          {config.blurb}
        </p>
      </div>

      {drafts.map((d) => {
        const locked = d.reservedCount > 0;
        const notesLeft = NOTES_MAX - d.notes.length;
        const name = d.label.trim() || config.noun;
        const unit = config.units.find((u) => u.value === d.unit);
        return (
          <div key={d.key} className="rounded border p-3 space-y-3" style={{ borderColor: COLORS.border }}>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem_14rem_auto] gap-3 items-end">
              <label className="block">
                <span className={LABEL} style={{ color: COLORS.muted }}>
                  Name
                </span>
                <input
                  type="text"
                  value={d.label}
                  maxLength={200}
                  onChange={(e) => editor.update(d.key, { label: e.target.value })}
                  className={INPUT}
                  style={{ borderColor: COLORS.border }}
                  placeholder={config.namePlaceholder}
                  aria-label={`${config.heading} — name`}
                />
              </label>
              <label className="block">
                <span className={LABEL} style={{ color: COLORS.muted }}>
                  {unit ? `$ per ${unit.noun}` : 'Amount ($)'}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={d.dollars}
                  onChange={(e) => editor.update(d.key, { dollars: e.target.value })}
                  className={INPUT}
                  style={{ borderColor: COLORS.border }}
                  placeholder={config.pricePlaceholder}
                  aria-label={`${name} — price`}
                />
              </label>
              {/* The unit says what a booked quantity counts; once exhibitors
                  have booked, changing it would reprice them, which the
                  backend refuses, so it is locked here. */}
              <label
                className="block"
                title={
                  locked
                    ? `${d.reservedCount} exhibitor${d.reservedCount === 1 ? ' has' : 's have'} booked this. Remove it and add it again to change how it's charged.`
                    : undefined
                }
              >
                <span className={LABEL} style={{ color: COLORS.muted }}>
                  Charged
                </span>
                <select
                  value={d.unit}
                  disabled={locked}
                  onChange={(e) => editor.update(d.key, { unit: e.target.value })}
                  className={`${INPUT} disabled:opacity-60`}
                  style={{ borderColor: COLORS.border }}
                  aria-label={`${name} — how it's charged`}
                >
                  {config.units.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.choice}
                    </option>
                  ))}
                  {!unit && <option value={d.unit}>{d.unit.replace(/_/g, ' ')}</option>}
                </select>
              </label>
              <button
                type="button"
                onClick={() => editor.remove(d.key)}
                className="text-sm underline justify-self-start sm:justify-self-end py-2"
                style={{ color: COLORS.muted }}
              >
                Remove
              </button>
            </div>

            {config.early && (
              <div role="group" aria-label={`${name} — early rate`}>
                <p className="text-xs mb-1.5" style={{ color: COLORS.text }}>
                  Early rate{' '}
                  <span style={{ color: 'var(--text-dimmed)' }}>(optional — cheaper if they reserve by the date)</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-[8rem_minmax(0,22rem)] gap-3 items-end">
                  <label className="block">
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      Early amount ($)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={d.earlyDollars}
                      onChange={(e) => editor.update(d.key, { earlyDollars: e.target.value })}
                      className={INPUT}
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 50.00"
                      aria-label={`${name} — early rate amount`}
                    />
                  </label>
                  <div>
                    <span className={LABEL} style={{ color: COLORS.muted }}>
                      Reserve by
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="date"
                        value={d.earlyDeadline}
                        onChange={(e) =>
                          editor.update(d.key, {
                            earlyDeadline: e.target.value,
                            earlyDeadlineTime: timeForDay(e.target.value, d.earlyDeadlineTime),
                          })
                        }
                        className="min-w-[9.5rem] flex-1 border rounded px-3 py-2"
                        style={{ borderColor: COLORS.border }}
                        aria-label={`${name} — early rate deadline`}
                      />
                      <input
                        type="time"
                        value={d.earlyDeadlineTime}
                        disabled={!d.earlyDeadline}
                        title={d.earlyDeadline ? 'Optional' : 'Pick the reserve-by date first.'}
                        onChange={(e) => editor.update(d.key, { earlyDeadlineTime: e.target.value })}
                        className="w-32 border rounded px-3 py-2 disabled:opacity-50"
                        style={{ borderColor: COLORS.border }}
                        aria-label={`${name} — early rate deadline time`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <label className="block">
              <span className="flex justify-between gap-2 text-xs mb-1" style={{ color: COLORS.muted }}>
                <span>Notes (optional)</span>
                {notesLeft <= 100 && <span>{notesLeft} characters left</span>}
              </span>
              <input
                type="text"
                value={d.notes}
                maxLength={NOTES_MAX}
                onChange={(e) => editor.update(d.key, { notes: oneParagraph(e.target.value) })}
                className={INPUT}
                style={{ borderColor: COLORS.border }}
                placeholder={config.notesPlaceholder}
                aria-label={`${name} — notes`}
              />
            </label>
          </div>
        );
      })}

      {removedBooked.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
          {removedBooked.map((d) => d.label).join(', ')} {removedBooked.length === 1 ? 'has' : 'have'} been
          booked. Saving takes {removedBooked.length === 1 ? 'it' : 'them'} off exhibitors&apos; bills.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {starter && (
          <button
            type="button"
            onClick={() => editor.add(starter.label)}
            className="text-sm underline"
            style={{ color: COLORS.text }}
          >
            {starter.button}
          </button>
        )}
        <button type="button" onClick={() => editor.add()} className="text-sm underline" style={{ color: COLORS.text }}>
          + Add {drafts.length > 0 ? 'another' : 'a'} {config.noun}
        </button>
      </div>
    </section>
  );
}
