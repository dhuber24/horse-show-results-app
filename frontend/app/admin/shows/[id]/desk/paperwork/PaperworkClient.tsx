'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * What this show requires on paper, in two halves.
 *
 * **Health documents.** Coggins is universal; a Certificate of Veterinary
 * Inspection follows from crossing a state line, and vaccination rules come
 * from the venue rather than the breed association. So the other two are off
 * unless the show turns them on — a flat "no CVI on file" flag would light up
 * every in-state horse at every show and staff would learn to ignore the whole
 * panel.
 *
 * **Waivers.** Free text, because the entry blank and the liability release are
 * written by the venue's insurer or the fair board and this app has no business
 * supplying the words.
 */

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  accent: '#8b4513',
  border: '#d4b896',
  borderSoft: '#e8d5b7',
  surface: '#ffffff',
  surfaceSoft: '#faf7f2',
} as const;

export type Waiver = {
  id: string;
  title: string;
  body: string;
  is_required: boolean;
  sort_order: number;
};

export type HealthRequirements = {
  requires_coggins: boolean;
  requires_health_certificate: boolean;
  health_certificate_valid_days: number;
  requires_vaccination: boolean;
  vaccination_valid_days: number;
  vaccination_notes: string | null;
};

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
    >
      <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: COLORS.accent }}>
        {title}
      </h2>
      {hint && <p className="text-xs mt-1 mb-3" style={{ color: COLORS.muted }}>{hint}</p>}
      {children}
    </section>
  );
}

export default function PaperworkClient({
  showId,
  initialRequirements,
  initialWaivers,
}: {
  showId: string;
  initialRequirements: HealthRequirements;
  initialWaivers: Waiver[];
}) {
  const router = useRouter();
  const [req, setReq] = useState(initialRequirements);
  const [waivers, setWaivers] = useState(initialWaivers);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftRequired, setDraftRequired] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const saveRequirements = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/shows/${showId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requires_coggins: req.requires_coggins,
          requires_health_certificate: req.requires_health_certificate,
          health_certificate_valid_days: req.health_certificate_valid_days,
          requires_vaccination: req.requires_vaccination,
          vaccination_valid_days: req.vaccination_valid_days,
          vaccination_notes: req.vaccination_notes?.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail || 'Could not save these requirements.');
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const addWaiver = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/waivers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle.trim(),
          body: draftBody.trim(),
          is_required: draftRequired,
          sort_order: waivers.length,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.detail || 'Could not add that waiver.');
        return;
      }
      setWaivers((prev) => [...prev, body as Waiver]);
      setAdding(false);
      setDraftTitle('');
      setDraftBody('');
      setDraftRequired(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeWaiver = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/waivers/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        setError('Could not remove that waiver.');
        return;
      }
      setWaivers((prev) => prev.filter((w) => w.id !== id));
      setConfirmDelete(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p
          className="text-sm px-3 py-2 rounded border"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}
        >
          {error}
        </p>
      )}

      <Card
        title="Health documents"
        hint="What the office chases before the show and inspects at the desk. Judged against the show's last day, not today — a Coggins that lapses mid-week does not cover the horse."
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
            <input
              type="checkbox"
              className="mt-1"
              checked={req.requires_coggins}
              onChange={(e) => setReq({ ...req, requires_coggins: e.target.checked })}
            />
            <span>
              <span className="font-medium">Negative Coggins (EIA)</span>
              <span className="block text-xs" style={{ color: COLORS.muted }}>
                Must carry its own expiry date — how long a test stays good is a state rule, and
                the app does not know which state the horse is standing in.
              </span>
            </span>
          </label>

          <div className="pt-2 border-t" style={{ borderColor: COLORS.borderSoft }}>
            <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="checkbox"
                className="mt-1"
                checked={req.requires_health_certificate}
                onChange={(e) =>
                  setReq({ ...req, requires_health_certificate: e.target.checked })
                }
              />
              <span>
                <span className="font-medium">Health certificate (CVI)</span>
                <span className="block text-xs" style={{ color: COLORS.muted }}>
                  Usually only for out-of-state arrivals or a venue that insists.
                </span>
              </span>
            </label>
            {req.requires_health_certificate && (
              <label className="flex items-center gap-2 text-sm mt-2 ml-6" style={{ color: COLORS.text }}>
                Good for
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={req.health_certificate_valid_days}
                  onChange={(e) =>
                    setReq({
                      ...req,
                      health_certificate_valid_days: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-20 border rounded px-2 py-1 text-sm"
                  style={{ borderColor: COLORS.border }}
                />
                days from issue
              </label>
            )}
          </div>

          <div className="pt-2 border-t" style={{ borderColor: COLORS.borderSoft }}>
            <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="checkbox"
                className="mt-1"
                checked={req.requires_vaccination}
                onChange={(e) => setReq({ ...req, requires_vaccination: e.target.checked })}
              />
              <span>
                <span className="font-medium">Vaccination records</span>
                <span className="block text-xs" style={{ color: COLORS.muted }}>
                  Which shots is a venue rule, so say so below in your own words.
                </span>
              </span>
            </label>
            {req.requires_vaccination && (
              <div className="ml-6 mt-2 space-y-2">
                <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.text }}>
                  Good for
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={req.vaccination_valid_days}
                    onChange={(e) =>
                      setReq({
                        ...req,
                        vaccination_valid_days: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-20 border rounded px-2 py-1 text-sm"
                    style={{ borderColor: COLORS.border }}
                  />
                  days from issue
                </label>
                <textarea
                  rows={2}
                  value={req.vaccination_notes ?? ''}
                  onChange={(e) => setReq({ ...req, vaccination_notes: e.target.value })}
                  placeholder="e.g. Flu/rhino within 6 months; rabies current."
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{ borderColor: COLORS.border }}
                />
                <p className="text-xs" style={{ color: COLORS.muted }}>
                  Shown to exhibitors on their horse&apos;s health line, so they know what to bring.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={saveRequirements}
              disabled={busy}
              className="text-sm font-medium px-4 py-2 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: COLORS.accent }}
            >
              {busy ? 'Saving…' : 'Save requirements'}
            </button>
            {saved && <span className="text-sm" style={{ color: '#2f6b3f' }}>Saved.</span>}
          </div>
        </div>
      </Card>

      <Card
        title="Entry blank & releases"
        hint="Exhibitors sign these during show sign-up. Anyone who signs a paper blank at the counter gets recorded by staff at the desk, so the outstanding count works either way."
      >
        {waivers.length === 0 ? (
          <p className="text-sm mb-3" style={{ color: COLORS.muted }}>
            Nothing to sign yet.
          </p>
        ) : (
          <ul className="space-y-2 mb-3">
            {waivers.map((w) => (
              <li
                key={w.id}
                className="rounded border p-3"
                style={{ borderColor: COLORS.borderSoft, backgroundColor: COLORS.surfaceSoft }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: COLORS.text }}>
                      {w.title}
                      {!w.is_required && (
                        <span className="ml-2 text-xs font-normal" style={{ color: COLORS.muted }}>
                          optional
                        </span>
                      )}
                    </p>
                    <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: COLORS.muted }}>
                      {w.body.length > 240 ? `${w.body.slice(0, 240)}…` : w.body}
                    </p>
                  </div>
                  {confirmDelete === w.id ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs" style={{ color: '#b91c1c' }}>
                        Delete this and every signature on it?
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWaiver(w.id)}
                        disabled={busy}
                        className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
                        style={{ backgroundColor: '#b91c1c' }}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs hover:underline"
                        style={{ color: COLORS.muted }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(w.id)}
                      className="text-xs hover:underline shrink-0 text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div
            className="rounded border p-3 space-y-2"
            style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fffdf9' }}
          >
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title — e.g. Release of Liability"
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <textarea
              rows={7}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Paste the wording your venue or insurer requires."
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="checkbox"
                checked={draftRequired}
                onChange={(e) => setDraftRequired(e.target.checked)}
              />
              Required — counts against the desk&apos;s outstanding paperwork
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addWaiver}
                disabled={busy || !draftTitle.trim() || !draftBody.trim()}
                title={
                  !draftTitle.trim() || !draftBody.trim()
                    ? 'A waiver needs a title and the wording people are agreeing to'
                    : undefined
                }
                className="text-sm font-medium px-3 py-1.5 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: COLORS.accent }}
              >
                {busy ? 'Adding…' : 'Add waiver'}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-sm hover:underline"
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm hover:underline"
            style={{ color: COLORS.accent }}
          >
            + Add a waiver
          </button>
        )}
      </Card>
    </div>
  );
}
