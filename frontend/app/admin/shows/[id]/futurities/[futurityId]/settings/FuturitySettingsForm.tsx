'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import FuturityForm, {
  futurityToForm,
  toFuturityPayload,
  validate,
  type FuturityFormValue,
} from '../../FuturityForm';
import { saveFuturityWaiver } from '../../saveFuturityWaiver';
import {
  COLORS,
  PricedClassWarning,
  type ClassItem,
  type Futurity,
} from '../../futurity-shared';

/**
 * Editing a futurity is the same conversation as adding one, so this renders
 * the same form and differs only in the verb: PATCH rather than POST, and the
 * release reconciled against the row already on file.
 */
export default function FuturitySettingsForm({
  showId,
  futurity,
  classes,
}: {
  showId: string;
  futurity: Futurity;
  classes: ClassItem[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<FuturityFormValue>(() => futurityToForm(futurity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const existingWaiver = futurity.waivers[0] ?? null;

  function patch(next: Partial<FuturityFormValue>) {
    setValue((prev) => ({ ...prev, ...next }));
  }

  async function save() {
    setError(null);
    setOk(null);
    const problem = validate(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/futurities/${futurity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFuturityPayload(value)),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to save.');
        return;
      }

      const waiverProblem = await saveFuturityWaiver({
        showId,
        futurityId: futurity.id,
        existing: existingWaiver,
        value,
      });
      if (waiverProblem) {
        setError(`The futurity was saved, but ${waiverProblem}`);
        router.refresh();
        return;
      }

      setOk('Saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedClasses = classes.filter((c) => value.classIds.has(c.id));

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {ok && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#3f6b2f', backgroundColor: '#f1f7ee', color: '#3f6b2f' }}
        >
          {ok}
        </div>
      )}

      <PricedClassWarning
        showId={showId}
        classes={selectedClasses.map((c) => ({
          class_id: c.id,
          class_number: c.class_number,
          entry_fee_cents: c.entry_fee_cents,
        }))}
      />

      <FuturityForm
        value={value}
        onChange={patch}
        classes={classes}
        hasEntries={futurity.entry_count > 0}
        waiverSignatureCount={existingWaiver?.signature_count ?? 0}
      />

      <button
        onClick={save}
        disabled={busy}
        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
