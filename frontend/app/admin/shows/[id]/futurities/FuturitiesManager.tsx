'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import FuturityForm, {
  emptyFuturityForm,
  toFuturityPayload,
  validate,
  type FuturityFormValue,
} from './FuturityForm';
import { saveFuturityWaiver } from './saveFuturityWaiver';
import {
  COLORS,
  formatCents,
  formatDeadline,
  type ClassItem,
  type Futurity,
} from './futurity-shared';

export default function FuturitiesManager({
  showId,
  initialFuturities,
  classes,
}: {
  showId: string;
  initialFuturities: Futurity[];
  classes: ClassItem[];
}) {
  const [futurities] = useState<Futurity[]>(initialFuturities);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          + Add futurity
        </button>
      )}

      {creating && (
        <CreateFuturityForm
          showId={showId}
          classes={classes}
          onCancel={() => setCreating(false)}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
          Futurities
          <span className="ml-2 text-sm font-normal" style={{ color: COLORS.muted }}>
            ({futurities.length})
          </span>
        </h2>
        {futurities.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No futurities on this show. Most shows run none — skip this step unless
            yours does.
          </p>
        ) : (
          <ul className="space-y-2">
            {futurities.map((futurity) => (
              <li key={futurity.id}>
                <Link
                  href={`/admin/shows/${showId}/futurities/${futurity.id}`}
                  className="block p-3 rounded-lg border hover:bg-gray-50 transition"
                  style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
                >
                  <div className="font-medium" style={{ color: COLORS.text }}>
                    {futurity.name}
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: COLORS.muted }}>
                    <span>{futurity.classes.length} classes</span>
                    <span>· {futurity.entry_count} entered</span>
                    <span>
                      ·{' '}
                      {futurity.fee_tiers.length === 0
                        ? 'no fee categories yet'
                        : futurity.fee_tiers
                            .map((t) => formatCents(t.amount_cents))
                            .join(' / ')}
                    </span>
                    {futurity.entry_deadline && (
                      <span>· entries close {formatDeadline(futurity)}</span>
                    )}
                    {futurity.divisions.length > 0 && (
                      <span>
                        · {futurity.divisions.length} Hi-Point{' '}
                        {futurity.divisions.length === 1 ? 'division' : 'divisions'}
                      </span>
                    )}
                    {futurity.waivers.length > 0 && <span>· release on file</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Creates the futurity, its categories, its memberships and its release.
 *
 * The whole entry form in one pass rather than a name-then-configure stub,
 * because half of it is unusable: a futurity with no categories cannot take an
 * entry — the API refuses one rather than inventing a price — so a create form
 * that skipped them would produce something broken and say nothing about it.
 *
 * The release is a second request on purpose. It is a `show_waivers` row scoped
 * to this futurity, which means the signature machinery that already exists —
 * paper signatures, guardians, the desk's outstanding count — works on it
 * untouched. A futurity that fails to save takes its release with it, since
 * there is nothing to scope it to; a release that fails after the futurity
 * saved is reported without pretending the futurity did not.
 */
function CreateFuturityForm({
  showId,
  classes,
  onCancel,
}: {
  showId: string;
  classes: ClassItem[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<FuturityFormValue>(emptyFuturityForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<FuturityFormValue>) {
    setValue((prev) => ({ ...prev, ...next }));
  }

  async function submit() {
    setError(null);
    const problem = validate(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/futurities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFuturityPayload(value)),
      });
      const created = await res.json().catch(() => null);
      if (!res.ok) {
        setError(created?.detail || 'Failed to create the futurity.');
        return;
      }

      const waiverProblem = await saveFuturityWaiver({
        showId,
        futurityId: created.id,
        existing: null,
        value,
      });
      if (waiverProblem) {
        setError(
          `${value.name.trim()} was created, but its release was not saved: ${waiverProblem} Add it from Settings.`,
        );
        router.refresh();
        return;
      }

      router.refresh();
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold" style={{ color: COLORS.text }}>
        New futurity
      </h3>

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <FuturityForm value={value} onChange={patch} classes={classes} />

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          {busy ? 'Creating…' : 'Create futurity'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded text-sm border disabled:opacity-50"
          style={{ borderColor: COLORS.border, color: COLORS.text }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
