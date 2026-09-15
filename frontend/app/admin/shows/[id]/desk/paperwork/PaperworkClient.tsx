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
 * Which papers are required and whether the originals are produced at the
 * counter are two separate questions, and only the first one was ever asked.
 * The desk owed an inspection sign-off on every required document at every
 * show, whether or not that show ever meant to look at paper — so a show that
 * takes the upload as sufficient had a row per horse per document that nobody
 * there could meaningfully clear. `requires_physical_document_check` is the
 * second question, asked only once something is required.
 *
 * **Waivers.** Free text, because the entry blank and the liability release are
 * written by the venue's insurer or the fair board and this app has no business
 * supplying the words. Everything added here is required: the desk ticks it off
 * per exhibitor, and a waiver nobody chases is indistinguishable from one
 * somebody forgot to chase. A show that only wants something read puts it on
 * the show bill. Rows that pre-date this, and a futurity's own release, may
 * still be optional, so the list goes on marking those.
 */

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  accent: 'var(--accent)',
  border: 'var(--border)',
  borderSoft: 'var(--border-subtle)',
  surface: 'var(--surface)',
  surfaceSoft: 'var(--background)',
} as const;

export type Waiver = {
  id: string;
  title: string;
  body: string;
  is_required: boolean;
  /** Set when this release belongs to a futurity (migration 109) — only that
   *  futurity's entrants are asked to sign it. Written on the futurity's own
   *  settings screen, alongside the rest of its entry form. */
  futurity_id: string | null;
  futurity_name: string | null;
  sort_order: number;
};

export type HealthRequirements = {
  requires_coggins: boolean;
  requires_health_certificate: boolean;
  health_certificate_valid_days: number;
  requires_vaccination: boolean;
  vaccination_valid_days: number;
  vaccination_notes: string | null;
  /** Whether the originals have to be produced at the counter (migration 138).
   *  Only asked once something is required — but stored whatever the boxes
   *  above say, so turning a document off and on again does not lose the
   *  show's answer. */
  requires_physical_document_check: boolean;
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Whether to ask the physical-proof question at all. With nothing required
  // there is nothing to produce at the counter, and the control would be asking
  // about an empty list. The stored answer is untouched either way — ticking a
  // document back on brings the question back with the show's own answer in it,
  // rather than a default the show never chose.
  const anyDocumentRequired =
    req.requires_coggins || req.requires_health_certificate || req.requires_vaccination;

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
          requires_physical_document_check: req.requires_physical_document_check,
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
          // Every waiver added here is one the desk has to tick off. The form
          // used to ask, and an "optional" waiver is a row nobody chases and
          // nobody can tell from a forgotten one -- a show that merely wants
          // something read puts it on the show bill. Sent explicitly rather
          // than left to the schema default, so the intent is on the request.
          is_required: true,
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
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  // Editing a futurity's release belongs on that futurity's settings screen,
  // where the rest of its entry form is. Shown here read-only so the office can
  // see everything this show asks for in one list — and so a release that only
  // some exhibitors are asked for does not look like a bug.
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
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      <Card
        title="Health documents"
        hint="Select the health record documents required for this show."
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
              <span
                className="block text-xs"
                style={{ color: COLORS.muted }}
                title="A Coggins must carry its own expiry date: how long a negative test stays good is a state rule, and the app does not know which state the horse is standing in. Judged against the show's last day, not today."
              >
                Require exhibitors to upload a current Coggins document.
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
                <span
                  className="block text-xs"
                  style={{ color: COLORS.muted }}
                  title="Usually only for out-of-state arrivals or a venue that insists. A CVI is written as 'issued within N days', so the window below is counted from the issue date."
                >
                  Require a health certificate for this show.
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
                <span
                  className="block text-xs"
                  style={{ color: COLORS.muted }}
                  title="Which shots a horse needs is a venue rule rather than a breed-association one, so the app cannot supply the list."
                >
                  Require vaccination records (describe which ones below after checking the
                  box).
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

          {anyDocumentRequired && (
            <div className="pt-2 border-t" style={{ borderColor: COLORS.borderSoft }}>
              <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={req.requires_physical_document_check}
                  onChange={(e) =>
                    setReq({ ...req, requires_physical_document_check: e.target.checked })
                  }
                />
                <span>
                  <span className="font-medium">
                    Exhibitors must show these documents at the show
                  </span>
                  <span
                    className="block text-xs"
                    style={{ color: COLORS.muted }}
                    title="The desk sign-off is the only thing that answers whether a paper is genuine, present, and describes this horse — the uploaded file only answers whether the date is still good. Leave it off and the desk can still record a document it is handed; it just is not counted as paperwork the office owes."
                  >
                    The desk signs off on each one after inspecting the paper, and it counts as
                    outstanding paperwork until they do. Leave unticked if the uploaded document
                    is enough.
                  </span>
                </span>
              </label>
            </div>
          )}

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
            {saved && <span className="text-sm" style={{ color: 'var(--success)' }}>Saved.</span>}
          </div>
        </div>
      </Card>

      <Card
        title="Entry blank & releases"
        hint="Use this section to help the show staff keep track of signed waivers. Whatever is created here shows up on the exhibitor's registration for show staff to validate that a signed waiver was received."
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
                      {w.futurity_name && (
                        <span className="ml-2 text-xs font-normal" style={{ color: COLORS.accent }}>
                          {w.futurity_name} entrants only
                        </span>
                      )}
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
                      <span className="text-xs" style={{ color: 'var(--error)' }}>
                        Delete this and every signature on it?
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWaiver(w.id)}
                        disabled={busy}
                        className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
                        style={{ backgroundColor: 'var(--error)' }}
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
            style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}
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
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Exhibitors sign this at show sign-up, or hand a paper blank across the counter
              for staff to record. Either way it counts against the desk&apos;s outstanding
              paperwork until it is signed.
            </p>
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
