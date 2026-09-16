'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Can I have 42 again?"
 *
 * The commonest question a show office fields before a show, previously
 * answered by email and keyed in by hand. The exhibitor asks here and gets the
 * number outright when nothing else at the show holds it — see
 * `PUT /shows/{id}/register/back-number` for why this grants rather than
 * queues.
 *
 * Two things it deliberately does not do:
 *
 *  * It does not offer a "clear" affordance. Giving a number back is not a
 *    thing anyone asks for, and the field refills from whatever they hold.
 *  * It does not list the numbers already taken. That is a lot of integers to
 *    ship for a question the 409 answers instantly, by name, at the moment it
 *    actually matters.
 *
 * Somebody who never asks is given the lowest free number when they sign up
 * (`backnumbers.assign_back_number_if_missing`), so by the time this box is on
 * screen it usually shows a number already — asking here swaps it for theirs.
 * A number somebody else holds is refused, and the refusal is an alert rather
 * than small print under the box: the next thing they need to do is pick
 * another, and they have to see that to do it.
 */
export default function BackNumberRequest({
  showId,
  backNumber,
  preferredBackNumber,
}: {
  showId: string;
  /** What the show has issued them, if anything. */
  backNumber: number | null;
  /** What they asked for. Differs from `backNumber` once the office renumbers. */
  preferredBackNumber: number | null;
}) {
  const router = useRouter();
  const current = preferredBackNumber ?? backNumber;
  const [value, setValue] = useState(current == null ? '' : String(current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [taken, setTaken] = useState(false);

  const parsed = Number(value);
  const isValid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 9999;
  const unchanged = isValid && parsed === current;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/back-number`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_back_number: parsed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTaken(json?.detail?.code === 'BACK_NUMBER_TAKEN');
        setError(
          typeof json?.detail === 'string'
            ? json.detail
            : json?.detail?.message || json?.error || 'Could not save that back number.',
        );
        setSaving(false);
        return;
      }
      setTaken(false);
      setSaved(json?.signup?.back_number ?? parsed);
      setSaving(false);
      // The banner on the show page and the bill both read the back number, so
      // the whole route re-renders rather than this box updating on its own.
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  // The office issued them something other than what they asked for. Say so
  // rather than silently showing the request back to them — the number on
  // their back is the one that matters at the gate.
  const overridden =
    preferredBackNumber != null && backNumber != null && preferredBackNumber !== backNumber;

  return (
    <section
      className="mt-4 rounded-lg border p-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        Your back number
      </h2>
      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
        {backNumber != null
          ? 'Ride a number of your own? Ask for it here.'
          : 'Ask for a number, or leave it and one will be assigned.'}
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          type="number"
          min={1}
          max={9999}
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setTaken(false);
            setSaved(null);
          }}
          placeholder="e.g. 42"
          aria-label="Preferred back number"
          aria-invalid={taken || undefined}
          className="w-28 border rounded px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isValid || unchanged}
          className="text-sm font-medium px-3 py-2 rounded text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
          title={
            !isValid
              ? 'Enter a number between 1 and 9999'
              : unchanged
                ? 'That is already your number'
                : undefined
          }
        >
          {saving ? 'Saving…' : unchanged ? 'Saved' : 'Save number'}
        </button>
        {backNumber != null && !saved && (
          <span className="text-xs" style={{ color: 'var(--success)' }}>
            You have back number <strong>{backNumber}</strong>.
          </span>
        )}
        {saved != null && (
          <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>
            ✓ Back number {saved} is yours.
          </span>
        )}
      </div>

      {overridden && !saved && (
        <p className="text-xs mt-2" style={{ color: 'var(--warning)' }}>
          You asked for {preferredBackNumber}, but the show office has issued you{' '}
          <strong>{backNumber}</strong> — that is the number to wear.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm mt-2 rounded border px-3 py-2"
          style={{
            borderColor: 'var(--error-border)',
            backgroundColor: 'var(--error-bg)',
            color: 'var(--error-strong)',
          }}
        >
          {taken && <strong>That number is taken. </strong>}
          {error}
        </p>
      )}
    </section>
  );
}
