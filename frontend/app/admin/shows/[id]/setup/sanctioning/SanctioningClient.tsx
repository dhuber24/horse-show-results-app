'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type AssociationOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type ShowSanctioningRow = {
  association_id: string;
  code: string;
  name: string;
  per_class_fee_cents: number;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default function SanctioningClient({
  showId,
  associations,
  current,
}: {
  showId: string;
  associations: AssociationOption[];
  current: ShowSanctioningRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Pre-existing fees stay intact when toggling — we only flip membership
  // here. Per-class fee amounts are entered on Step 5 Fees.
  const initialFeeByAssoc: Record<string, number> = {};
  for (const c of current) initialFeeByAssoc[c.association_id] = c.per_class_fee_cents;

  const [pickedIds, setPickedIds] = useState<Set<string>>(
    () => new Set(current.map((c) => c.association_id)),
  );

  const [requestName, setRequestName] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestSent, setRequestSent] = useState(false);

  function isPicked(id: string): boolean {
    return pickedIds.has(id);
  }

  function togglePick(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const items = Array.from(pickedIds).map((id) => ({
        association_id: id,
        per_class_fee_cents: initialFeeByAssoc[id] ?? 0,
      }));
      const res = await fetch(`/api/shows/${showId}/sanctioning`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to save sanctioning.');
        return;
      }
      setSuccessMsg('Sanctioning saved. Set per-class fees in Step 5.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!requestName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/sanctioned-association-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_name: requestName.trim(),
          show_id: showId,
          notes: requestNotes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Failed to submit request.');
        return;
      }
      setRequestSent(true);
      setRequestName('');
      setRequestNotes('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {successMsg}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Available sanctioning associations
        </h2>
        {associations.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No sanctioning associations are configured. Request one below.
          </p>
        ) : (
          <>
          <ul className="space-y-2">
            {associations.map((a) => {
              const picked = isPicked(a.id);
              return (
                <li
                  key={a.id}
                  className="rounded border p-3 flex items-center gap-3 flex-wrap"
                  style={{
                    borderColor: picked ? COLORS.warn : COLORS.border,
                    backgroundColor: picked ? COLORS.warnSoft : COLORS.bg,
                  }}
                >
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => togglePick(a.id)}
                    />
                    <span style={{ color: COLORS.text }}>
                      <span
                        className="font-mono mr-2 font-semibold"
                        style={{ color: '#8b4513' }}
                      >
                        {a.code}
                      </span>
                      {a.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Per-class fees for sanctioning associations are entered in Step 5: Show Fees.
          </p>
          </>
        )}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            {busy ? 'Saving…' : 'Save sanctioning'}
          </button>
        </div>
      </section>

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Request a new sanctioning association
        </h2>
        <p className="text-xs" style={{ color: COLORS.muted }}>
          Don&apos;t see the sanctioning body you need? Submit a request and an admin will review.
        </p>
        {requestSent ? (
          <div
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
          >
            Request submitted. An admin will review.
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder="Association name (e.g. International Buckskin Horse Assoc.)"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <textarea
              placeholder="Notes (optional) — link to association, context, etc."
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border, minHeight: 60 }}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={submitRequest}
                disabled={busy || !requestName.trim()}
                className="text-sm rounded px-3 py-2 border disabled:opacity-50"
                style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
              >
                Submit request
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
