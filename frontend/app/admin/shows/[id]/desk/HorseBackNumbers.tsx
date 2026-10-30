'use client';

import { useEffect, useState } from 'react';
import { COLORS, horseHoldingNumber, nextFreeHorseNumber } from './types';
import type { Desk, DeskExhibitor, DeskHorse } from './types';

/**
 * One back number per horse, at a show that numbers horses (migration 161) or
 * each exhibitor on each horse (migration 178).
 *
 * Takes the place of the single "Back #" box in the panel header: APHA
 * SC-160.D numbers the horse, so somebody who brought three horses wears three
 * numbers and the desk needs a box beside each. At a horse-numbered show a
 * horse shown by two exhibitors is one row under each of them with the same
 * number — changing it under one changes it under both, because it is one
 * number. At a pair-numbered show those two rows are two numbers, and each is
 * saved as that exhibitor's own.
 *
 * Every horse is given the lowest free number the moment it is first entered
 * (`backnumbers.assign_horse_number_if_missing`), so this is usually where a
 * number is *changed* rather than handed out. "Assign" is for the horse that
 * slipped through — one entered before the show was switched to numbering
 * horses, say.
 */
export default function HorseBackNumbers({
  showId,
  desk,
  exhibitor,
  busy,
  run,
}: {
  showId: string;
  desk: Desk;
  exhibitor: DeskExhibitor;
  busy: Set<string>;
  /** The panel's own mutation runner: busy flag, error banner, desk reload. */
  run: (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;
}) {
  if (exhibitor.horses.length === 0) {
    return (
      <div className="text-right">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.accent }}>
          Back numbers
        </p>
        <p className="text-xs mt-1 max-w-[14rem]" style={{ color: COLORS.muted }}>
          {desk.back_number_per === 'pair'
            ? 'This show gives each exhibitor a number for each horse they show. Each one arrives when the horse is entered in a class.'
            : 'This show numbers horses. Each horse gets its number when it is entered in a class.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: COLORS.accent }}>
        Back numbers
      </p>
      <ul className="space-y-1.5">
        {exhibitor.horses.map((horse) => (
          <HorseNumberRow
            key={horse.horse_id}
            showId={showId}
            desk={desk}
            exhibitorId={exhibitor.exhibitor_id}
            horse={horse}
            busy={busy}
            run={run}
          />
        ))}
      </ul>
    </div>
  );
}

function HorseNumberRow({
  showId,
  desk,
  exhibitorId,
  horse,
  busy,
  run,
}: {
  showId: string;
  desk: Desk;
  /** Whose list this row is in — whose number it is, at a pair-numbered show. */
  exhibitorId: string;
  horse: DeskHorse;
  busy: Set<string>;
  run: (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;
}) {
  const held = horse.back_number ?? null;
  const [value, setValue] = useState(held?.toString() ?? '');
  useEffect(() => {
    setValue(held?.toString() ?? '');
  }, [horse.horse_id, held]);

  const self = { exhibitorId, horseId: horse.horse_id };
  const key = `horse-number-${exhibitorId}-${horse.horse_id}`;
  const saving = busy.has(key);
  const dirty = (held?.toString() ?? '') !== value.trim();
  const typed = value.trim() === '' ? null : Number(value);
  // Said before Save rather than after a 409, and named, because "who has
  // 42?" is the next question.
  const holder = typed === null ? undefined : horseHoldingNumber(desk, typed, self);

  const save = (next: string = value) =>
    run(
      key,
      () =>
        fetch('/api/back-numbers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            showId,
            horses: [
              {
                horse_id: horse.horse_id,
                // Whose number it is at a pair-numbered show; ignored at a
                // horse-numbered one, where the horse has one number.
                exhibitor_id: exhibitorId,
                back_number: next.trim() === '' ? null : parseInt(next, 10),
              },
            ],
          }),
        }),
      'Could not save that back number.',
    );

  const assignNextFree = () => {
    const next = String(nextFreeHorseNumber(desk, self));
    setValue(next);
    return save(next);
  };

  const label = `Back number for ${horse.horse_name}`;

  return (
    <li>
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm truncate max-w-[10rem]" style={{ color: COLORS.text }} title={horse.horse_name}>
          {horse.barn_name || horse.horse_name}
        </span>
        <input
          type="number"
          min="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="--"
          aria-label={label}
          className="w-20 border rounded px-2 py-1 text-base font-mono text-center"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.surfaceSoft, color: COLORS.text }}
        />
        {held == null && value.trim() === '' ? (
          <button
            type="button"
            onClick={assignNextFree}
            disabled={saving}
            title="The lowest number nobody else at this show holds or has asked for"
            className="px-2.5 py-1.5 rounded text-xs font-medium disabled:opacity-50 whitespace-nowrap"
            style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
          >
            {saving ? 'Saving…' : `Assign #${nextFreeHorseNumber(desk, self)}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => save()}
            disabled={!dirty || Boolean(holder) || saving}
            title={
              holder
                ? `${holder.horse_name} (${holder.exhibitor_name}) already has this number`
                : dirty
                  ? undefined
                  : 'The number on screen is the one on file'
            }
            className="px-2.5 py-1.5 rounded text-xs font-medium disabled:opacity-50"
            style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {/* Only when the two disagree, as on the exhibitor's own number. */}
      {horse.preferred_back_number != null && horse.preferred_back_number !== held && (
        <p className="text-xs mt-0.5 text-right" style={{ color: 'var(--warning)' }}>
          asked for {horse.preferred_back_number}
        </p>
      )}
      {holder && dirty && (
        <p
          role="alert"
          className="mt-1 text-xs rounded px-2 py-1"
          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
        >
          #{typed} is already on <strong>{holder.horse_name}</strong> ({holder.exhibitor_name}).
        </p>
      )}
    </li>
  );
}
