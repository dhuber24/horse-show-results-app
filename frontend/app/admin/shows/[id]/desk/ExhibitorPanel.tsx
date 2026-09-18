'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import AddEntryForm from './AddEntryForm';
import CheckRow, { type VerificationKind } from './CheckRow';
import DocumentViewer from './DocumentViewer';
import { UnenrolledFuturityRow, WithdrawFuturityButton } from './FuturityEnrollment';
import HealthCheckRow from './HealthCheckRow';
import StaffAddHorseForm, { type AssociationOption, type LookupOption } from './StaffAddHorseForm';
import WaiverRow from './WaiverRow';
import {
  COLORS,
  futurityEnrollment,
  futurityForClass,
  healthAlerts,
  nextFreeBackNumber,
  unenrolledFuturityHorses,
} from './types';
import type { Desk, DeskExhibitor } from './types';
import { formatMoney } from '@/lib/financials';
import type { BillClassLine } from '@/lib/my-shows';

/** The subject of a paperwork sign-off, as the backend wants it posted. */
type Subject = {
  kind: VerificationKind;
  horse_id?: string;
  exhibitor_id?: string;
  association_id?: string | null;
  document_type?: string;
  /** Health documents only: the expiry staff read off the paper. Not part of
   *  the subject's identity, so it is left out of `subjectKey` — re-inspecting
   *  the same document with a new date is the same check, not another one. */
  attested_expiry?: string | null;
};

function subjectKey(s: Subject): string {
  return [
    s.kind,
    s.horse_id ?? '',
    s.exhibitor_id ?? '',
    s.association_id ?? '',
    s.document_type ?? '',
  ].join('|');
}

/** The DOM id of one check's row, so a warning at the top of the panel can
 *  scroll to the thing it is warning about. Derived from the subject rather
 *  than an index: the roster reloads after every save and a positional id
 *  would point at a different row afterwards. */
function anchorFor(s: Subject): string {
  return `desk-check-${subjectKey(s)}`;
}

/** The id of the Paperwork section, for a jump with no single row to land on. */
const PAPERWORK_SECTION_ID = 'desk-section-paperwork';

/**
 * The first sign-off the desk still owes, in the order the panel renders them.
 *
 * This is the same set `paperwork_outstanding` counts — memberships, foaling
 * dates, registration papers, and (where the show asks for the originals) the
 * health inspections. The health *status* is deliberately not in it: a lapsed
 * Coggins is the exhibitor's to fix and has its own warning, which jumps to its
 * own row.
 */
function firstOutstandingPaperwork(
  exhibitor: DeskExhibitor,
  physicalCheck: boolean,
): { anchor: string; label: string } | null {
  for (const check of exhibitor.memberships) {
    if (check.status !== 'verified') {
      return {
        anchor: anchorFor({
          kind: 'exhibitor_membership',
          exhibitor_id: exhibitor.exhibitor_id,
          association_id: check.association_id,
        }),
        label: `${check.association_code ?? 'Membership'} membership`,
      };
    }
  }
  for (const horse of exhibitor.horses) {
    if (horse.age_check.status !== 'verified') {
      return {
        anchor: anchorFor({ kind: 'horse_age', horse_id: horse.horse_id }),
        label: `${horse.horse_name} — foaling date`,
      };
    }
    for (const check of horse.registrations) {
      if (check.status !== 'verified') {
        return {
          anchor: anchorFor({
            kind: 'horse_registration',
            horse_id: horse.horse_id,
            association_id: check.association_id,
          }),
          label: `${horse.horse_name} — ${check.association_code ?? 'registration'} papers`,
        };
      }
    }
    if (!physicalCheck) continue;
    for (const check of horse.health ?? []) {
      if ((check.inspection?.status ?? 'unverified') !== 'verified') {
        return {
          anchor: anchorFor({
            kind: 'horse_health_document',
            horse_id: horse.horse_id,
            document_type: check.code,
          }),
          label: `${horse.horse_name} — ${check.label}`,
        };
      }
    }
  }
  return null;
}

/** Which uploaded document backs each kind of check, so "View" on a row opens
 *  the right paper. Age and registration both come off the same one. */
const REGISTRATION_PAPERS = 'REGISTRATION';

/** Which document a horse card currently has open, if any. */
type OpenDocument = { horseId: string; documentType: string; title: string };

function backendMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  const d = detail as { code?: string; message?: string; issues?: { severity: string; message: string }[] };
  if (d?.code === 'ASSOCIATION_VALIDATION_FAILED' && Array.isArray(d.issues)) {
    return d.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ');
  }
  return d?.message ?? fallback;
}

/** What makes up a class row's fee, for its tooltip — "$0.00 class fee + $5.00
 *  APHA Fee". Undefined when the class's own fee is the whole of it, so a plain
 *  row carries no tooltip restating the number beside it. */
function classFeeBreakdown(line: BillClassLine): string | undefined {
  const parts = [`${formatMoney(line.fee_cents)} class fee`];
  if (line.sanction_cents > 0) parts.push(`${formatMoney(line.sanction_cents)} club sanction`);
  for (const charge of line.charges ?? []) parts.push(`${formatMoney(charge.cents)} ${charge.label}`);
  return parts.length > 1 ? parts.join(' + ') : undefined;
}

/** Which panel sections staff have folded away. Remembered in this browser
 *  across exhibitors and visits: the desk is one screen worked all day, and
 *  somebody who only ever takes entries should not have to fold Paperwork away
 *  again for every person in the queue. */
const COLLAPSED_SECTIONS_KEY = 'gaitdesk.desk.collapsedSections';

function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage blocked or unreadable: every section starts open.
    }
  }, []);

  const write = (next: Set<string>) => {
    try {
      window.localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Not remembered, but still folded for this visit.
    }
    return next;
  };

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return write(next);
    });
  }, []);

  // Open a section without knowing whether it was folded. Used by the jump
  // links at the top of the panel: sending somebody to a check inside a section
  // they folded away last Tuesday would scroll to nothing.
  const expand = useCallback((key: string) => {
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return write(next);
    });
  }, []);

  return { collapsed, toggle, expand };
}

/**
 * Scroll one row into view and ring it briefly.
 *
 * The desk panel is long enough that opening the Paperwork section is not the
 * same as showing somebody the check they clicked for — on a laptop at the
 * counter the row they want is often still below the fold. The ring is what
 * says "this one", since a scroll on its own leaves the eye hunting.
 *
 * Keyed on an object rather than the id so clicking the same warning twice
 * fires again; with a bare string the second press is a no-op dependency.
 */
function useRevealRow(target: { id: string; nonce: number } | null) {
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target.id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Inline rather than a class: the colour is a token either way, and this
    // is a transient state no stylesheet needs to know about.
    el.style.outline = '2px solid var(--accent)';
    el.style.outlineOffset = '3px';
    el.style.borderRadius = '4px';
    const timer = setTimeout(() => {
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.borderRadius = '';
    }, 2000);
    return () => clearTimeout(timer);
  }, [target]);
}

function Section({
  id,
  title,
  hint,
  badge,
  collapsed,
  onToggle,
  children,
}: {
  /** Scroll target for the jump links, when the section itself is the answer
   *  and no single row inside it is. */
  id?: string;
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const bodyId = useId();
  return (
    <section id={id} className="rounded-lg border p-4" style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}>
      <div className={`flex items-baseline justify-between gap-3 ${collapsed ? '' : 'mb-2'}`}>
        <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: COLORS.accent }}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="flex items-center gap-1.5 uppercase tracking-wide hover:underline"
          >
            <span
              aria-hidden
              className="inline-block text-xs transition-transform"
              style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
            >
              ▾
            </span>
            {title}
          </button>
        </h3>
        {/* The badge stays up when folded — "3 to check" is the reason to open
            the section again. */}
        {badge}
      </div>
      {/* Hidden rather than unmounted, so a half-filled entry form survives
          being folded away and opened again. */}
      <div id={bodyId} hidden={collapsed}>
        {hint && <p className="text-xs mb-3" style={{ color: COLORS.muted }}>{hint}</p>}
        {children}
      </div>
    </section>
  );
}

export default function ExhibitorPanel({
  showId,
  desk,
  exhibitor,
  associations,
  breeds,
  colors,
  patterns,
  onChanged,
  onRemoved,
}: {
  showId: string;
  desk: Desk;
  exhibitor: DeskExhibitor;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
  patterns: LookupOption[];
  /** Re-reads the whole desk. Every mutation goes through the endpoint that
   *  already owned that job, so the authoritative state is always the reload. */
  onChanged: () => Promise<void>;
  onRemoved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [backNumber, setBackNumber] = useState(exhibitor.back_number?.toString() ?? '');
  const [addingHorse, setAddingHorse] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // The entry form owns the exhibitor's horse list. Adding a horse further down
  // this panel has to make it reappear in the picker above, and bumping this
  // remounts the form so it refetches — the horse is added precisely because
  // somebody is about to enter it.
  const [horseListVersion, setHorseListVersion] = useState(0);
  // One document open at a time, across the whole panel. The desk has a queue
  // behind it and a screen full of open scans is worse than none.
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  // Taking an emergency contact over the counter. Pre-filled from the profile
  // so editing an existing one is a deliberate change rather than a retype.
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const { collapsed, toggle, expand } = useCollapsedSections();
  // Where a jump link is sending the eye. Set by the warnings at the top of the
  // panel; cleared by nothing, because the ring times itself out.
  const [revealing, setRevealing] = useState<{ id: string; nonce: number } | null>(null);
  useRevealRow(revealing);

  /** Open the section a check lives in, then scroll to the check itself.
   *  Both in one press: a warning that only unfolded the section would leave
   *  staff scanning a long panel for the row it was talking about. */
  const jumpTo = useCallback(
    (sectionKey: string, anchorId: string) => {
      expand(sectionKey);
      setRevealing({ id: anchorId, nonce: Date.now() });
    },
    [expand],
  );

  useEffect(() => {
    setBackNumber(exhibitor.back_number?.toString() ?? '');
    setConfirmRemove(false);
    setError(null);
    setOpenDocument(null);
    setEditingContact(false);
  }, [exhibitor.exhibitor_id, exhibitor.back_number]);

  const toggleDocument = (next: OpenDocument) =>
    setOpenDocument((current) =>
      current && current.horseId === next.horseId && current.documentType === next.documentType
        ? null
        : next,
    );

  /** Runs one mutation, then re-reads the desk. Failures surface the backend's
   *  own message — association validation and the duplicate-entry rules say
   *  something useful and there is no point replacing that with "failed". */
  const run = async (key: string, fn: () => Promise<Response>, fallback: string): Promise<boolean> => {
    setBusy((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const res = await fn();
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(backendMessage(body?.detail ?? body?.error, fallback));
        return false;
      }
      await onChanged();
      return true;
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const saveBackNumber = (value: string = backNumber) =>
    run(
      'back-number',
      () =>
        fetch('/api/back-numbers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            showId,
            assignments: [
              {
                exhibitor_id: exhibitor.exhibitor_id,
                back_number: value.trim() === '' ? null : parseInt(value, 10),
              },
            ],
          }),
        }),
      'Could not save that back number.',
    );

  const assignNextFree = () => {
    const next = String(nextFreeBackNumber(desk, exhibitor.exhibitor_id));
    setBackNumber(next);
    return saveBackNumber(next);
  };

  const removeEntry = (entryId: string, classId: string) =>
    run(
      `entry-${entryId}`,
      () => fetch(`/api/entries/${entryId}?showId=${showId}&classId=${classId}`, { method: 'DELETE' }),
      'Could not remove that entry.',
    );

  const verify = (subject: Subject) =>
    run(
      subjectKey(subject),
      () =>
        fetch(`/api/shows/${showId}/verifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subject),
        }),
      'That sign-off did not save.',
    );

  const undoVerify = (subject: Subject, verificationId: string) =>
    run(
      subjectKey(subject),
      () => fetch(`/api/shows/${showId}/verifications/${verificationId}`, { method: 'DELETE' }),
      'Could not undo that sign-off.',
    );

  // A futurity release is recorded as "on file" with no name: the backend puts
  // the exhibitor's own name on it, and refuses the same empty body on any
  // other waiver.
  const recordWaiver = (
    waiverId: string,
    body:
      | { signed_name: string; signed_by_guardian: boolean; guardian_relationship: string | null }
      | Record<string, never>,
  ) =>
    run(
      `waiver-${waiverId}`,
      () =>
        fetch(
          `/api/shows/${showId}/exhibitors/${exhibitor.exhibitor_id}/waivers/${waiverId}/signature`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        ),
      'Could not record that signature.',
    );

  const undoWaiver = (waiverId: string) =>
    run(
      `waiver-${waiverId}`,
      () =>
        fetch(
          `/api/shows/${showId}/exhibitors/${exhibitor.exhibitor_id}/waivers/${waiverId}/signature`,
          { method: 'DELETE' },
        ),
      'Could not remove that signature.',
    );

  const saveEmergencyContact = async (name: string | null, phone: string | null) => {
    const ok = await run(
      'emergency-contact',
      () =>
        fetch(`/api/shows/${showId}/exhibitors/${exhibitor.exhibitor_id}/emergency-contact`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone }),
        }),
      'Could not save that emergency contact.',
    );
    if (ok) setEditingContact(false);
  };

  const startEditingContact = () => {
    setContactName(exhibitor.emergency_contact?.name ?? '');
    setContactPhone(exhibitor.emergency_contact?.phone ?? '');
    setEditingContact(true);
  };

  const cancelRegistration = async () => {
    const ok = await run(
      'cancel-registration',
      () =>
        fetch(`/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: cancelReason.trim() || null }),
        }),
      'Could not cancel that registration.',
    );
    if (ok) {
      setConfirmCancel(false);
      setCancelReason('');
      onChanged();
    }
  };

  const removeFromRoster = async () => {
    const ok = await run(
      'remove-roster',
      () =>
        fetch(`/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}`, {
          method: 'DELETE',
        }),
      'Could not remove that registration.',
    );
    if (ok) onRemoved();
  };

  const alerts = healthAlerts(exhibitor);
  // Where the outstanding-paperwork warning sends staff. Computed here so the
  // tooltip can name it, and recomputed on every reload — the answer moves as
  // checks are signed off.
  const nextPaperwork = firstOutstandingPaperwork(
    exhibitor,
    desk.requires_physical_document_check,
  );
  const potCount = exhibitor.side_pot_ids.length;

  /** What scratching this entry would also give back, as a sentence — empty
   *  when nothing is released. Mirrors `pots_to_release`: only pots that bundle
   *  this class, only where the exhibitor keeps no other entry in that pot's
   *  classes, and only pots still open. The backend is the authority; this is
   *  so a money change does not arrive unannounced under a "Remove" link. */
  const releasedPotsIfRemoved = (entry: DeskExhibitor['entries'][number]): string => {
    const remaining = exhibitor.entries.filter((e) => e.entry_id !== entry.entry_id);
    const released = desk.side_pots.filter(
      (pot) =>
        pot.status === 'open' &&
        exhibitor.side_pot_ids.includes(pot.id) &&
        (pot.class_ids ?? []).includes(entry.class_id) &&
        !remaining.some((e) => (pot.class_ids ?? []).includes(e.class_id)),
    );
    if (released.length === 0) return '';
    return `Also takes them out of ${released
      .map((pot) => `${pot.name} (${formatMoney(pot.entry_fee_cents)} buy-in back)`)
      .join(' and ')} — it was their last class in it.`;
  };

  /** The same warning for a futurity nomination, which a scratch releases the
   *  same way. Mirrors `enrollments_to_release`, and note the difference from
   *  the pots above: this is keyed on the **horse**, because two horses of one
   *  exhibitor in the same futurity are two nominations. */
  const releasedFuturitiesIfRemoved = (entry: DeskExhibitor['entries'][number]): string => {
    if (!entry.horse_id) return '';
    const remaining = exhibitor.entries.filter(
      (e) => e.entry_id !== entry.entry_id && e.horse_id === entry.horse_id,
    );
    const released = (desk.futurities ?? []).filter(
      (f) =>
        f.class_ids.includes(entry.class_id) &&
        futurityEnrollment(exhibitor, f.id, entry.horse_id) !== undefined &&
        !remaining.some((e) => f.class_ids.includes(e.class_id)),
    );
    if (released.length === 0) return '';
    return `Also withdraws ${entry.horse_name ?? 'this horse'} from ${released
      .map((f) => f.name)
      .join(' and ')} — it was their last class in it.`;
  };

  /** Both releases as one tooltip, so a scratch never changes money silently. */
  const alsoReleasedIfRemoved = (entry: DeskExhibitor['entries'][number]): string =>
    [releasedPotsIfRemoved(entry), releasedFuturitiesIfRemoved(entry)]
      .filter(Boolean)
      .join(' ');
  const backNumberDirty = (exhibitor.back_number?.toString() ?? '') !== backNumber.trim();
  // Somebody else already wears the number being typed. Said before Save rather
  // than after a 409, and named, because "who has 42?" is the next question.
  const typedNumber = backNumber.trim() === '' ? null : Number(backNumber);
  const backNumberHolder =
    typedNumber === null
      ? undefined
      : desk.exhibitors.find(
          (e) => e.exhibitor_id !== exhibitor.exhibitor_id && e.back_number === typedNumber,
        );

  // Money quoted off the bill, never re-added here. A futurity class carries no
  // fee of its own, so summing `entry_fee_cents` read $0 for it.
  const bill = exhibitor.bill;
  // A per-class charge (the breed body's per-judge assessment) is on the class
  // lines too, so it counts as class money here and shows on each row. Without
  // it a $0 class carrying a $5 assessment read $0 while the header billed $5.
  // Charges that belong to no class — a per-horse office fee, a club's
  // per-horse sanction — stay out of this section: it is the classes, and the
  // header's billed figure already carries the rest.
  const classChargeCents = bill?.class_charge_total_cents ?? 0;
  const classFeesCents = bill
    ? bill.class_fee_total_cents + bill.class_sanction_total_cents + classChargeCents
    : 0;
  const futurityCents = bill?.futurity_total_cents ?? 0;
  const futurityLines = bill?.futurity_lines ?? [];
  // Side pot buy-ins, which the bill charges now that entering a bundled class
  // is what buys somebody in. Read off the bill like everything else here — the
  // pot's `entry_fee_cents` is on the desk payload and summing it in the
  // browser is exactly the disagreement billing.py exists to prevent.
  const sidePotCents = bill?.side_pot_total_cents ?? 0;
  const sidePotLines = bill?.side_pot_lines ?? [];
  const unenrolled = unenrolledFuturityHorses(desk, exhibitor);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold" style={{ color: COLORS.text }}>
              {exhibitor.exhibitor_name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
              {exhibitor.cancelled_at
                ? 'Registration cancelled — kept here for their account.'
                : exhibitor.signed_up
                  ? 'Signed themselves up for this show.'
                  : 'Added at the desk — has not completed show sign-up.'}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label
                htmlFor="desk-back-number"
                className="text-xs font-semibold uppercase tracking-wide block mb-1"
                style={{ color: COLORS.accent }}
              >
                Back #
              </label>
              <input
                id="desk-back-number"
                type="number"
                min="1"
                value={backNumber}
                onChange={(e) => setBackNumber(e.target.value)}
                placeholder="--"
                className="w-24 border rounded px-2 py-1.5 text-lg font-mono text-center"
                style={{ borderColor: COLORS.border, backgroundColor: COLORS.surfaceSoft, color: COLORS.text }}
              />
              {/* Only when the two disagree. Repeating a granted request back
                  at staff would be noise on every row. */}
              {exhibitor.preferred_back_number != null
                && exhibitor.preferred_back_number !== exhibitor.back_number && (
                <p className="text-xs mt-1 text-center" style={{ color: 'var(--warning)' }}>
                  asked for {exhibitor.preferred_back_number}
                </p>
              )}
            </div>
            {exhibitor.back_number == null && backNumber.trim() === '' ? (
              <button
                type="button"
                onClick={assignNextFree}
                disabled={busy.has('back-number')}
                title="The lowest number nobody at this show holds or has asked for"
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
              >
                {busy.has('back-number')
                  ? 'Saving…'
                  : `Assign #${nextFreeBackNumber(desk, exhibitor.exhibitor_id)}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => saveBackNumber()}
                disabled={!backNumberDirty || Boolean(backNumberHolder) || busy.has('back-number')}
                title={
                  backNumberHolder
                    ? `${backNumberHolder.exhibitor_name} already has this number`
                    : backNumberDirty
                      ? undefined
                      : 'The number on screen is the one on file'
                }
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
              >
                {busy.has('back-number') ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>

        {backNumberHolder && backNumberDirty && (
          <p
            role="alert"
            className="mt-2 text-sm rounded px-3 py-2"
            style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
          >
            Back #{typedNumber} is already held by <strong>{backNumberHolder.exhibitor_name}</strong>.
            Pick a different number.
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 pt-3 border-t text-sm" style={{ borderColor: COLORS.borderSoft }}>
          <span style={{ color: COLORS.muted }}>
            {exhibitor.entries.length} class{exhibitor.entries.length === 1 ? '' : 'es'}
          </span>
          {/* The last trace of the pots on this panel, and it is a statement
              rather than a control: buying in is what entering one of a pot's
              classes now does, so there is nothing here to decide. The two
              facts staff still need are which pots they are in and that the
              money is not in the billed figure beside it — the second one has
              nowhere else to live now the section is gone, so it rides on the
              title where it costs no screen. Adding or removing a buy-in is
              the pot's own Entries screen. */}
          {desk.side_pots.length > 0 && (
            <span
              style={{ color: COLORS.muted }}
              title={
                potCount === 0
                  ? 'Entering a class a side pot covers buys them in — nothing to do here'
                  : `In: ${desk.side_pots
                      .filter((pot) => exhibitor.side_pot_ids.includes(pot.id))
                      .map((pot) => `${pot.name} (${formatMoney(pot.entry_fee_cents)})`)
                      .join(', ')}. Buy-ins settle with the show bill and are not in the billed figure beside this — pot money is reported on Financials.`
              }
            >
              {potCount} side pot{potCount === 1 ? '' : 's'}
            </span>
          )}
          {/* A count is a fact; the desk needs the next thing to do. Pressing
              this opens the Paperwork section and scrolls to the first check
              still owed, naming it in the tooltip so staff know where they are
              being sent before they press. */}
          {exhibitor.paperwork_outstanding > 0 ? (
            <button
              type="button"
              onClick={() =>
                jumpTo('paperwork', nextPaperwork?.anchor ?? PAPERWORK_SECTION_ID)
              }
              className="underline decoration-dotted hover:decoration-solid text-left"
              style={{ color: 'var(--warning)' }}
              title={
                nextPaperwork
                  ? `Go to the first one still to check: ${nextPaperwork.label}`
                  : 'Go to the paperwork section'
              }
            >
              {exhibitor.paperwork_outstanding} paperwork check
              {exhibitor.paperwork_outstanding === 1 ? '' : 's'} outstanding →
            </button>
          ) : (
            <span style={{ color: 'var(--success)' }}>Paperwork all checked</span>
          )}
          {/* The panel's only money figures. Paid is here because billed and
              owing alone cannot answer "how much have they already given us?",
              which is the question being asked when somebody is standing at
              the counter with a chequebook. */}
          <span style={{ color: exhibitor.balance_cents > 0 ? 'var(--error)' : COLORS.muted }}>
            {formatMoney(exhibitor.billed_cents)} billed · {formatMoney(exhibitor.net_paid_cents)} paid
            {' · '}
            {formatMoney(exhibitor.balance_cents)} owing
          </span>
          {/* Straight to this exhibitor's own account, opened, rather than to a
              list of everyone's — somebody is standing at the counter with a
              chequebook and the office should not have to find them twice. The
              screen there links back here with the same id. */}
          <Link
            href={`/admin/shows/${showId}/financials/exhibitors?exhibitor=${exhibitor.exhibitor_id}`}
            className="hover:underline"
            style={{ color: COLORS.accent }}
            title={`Open ${exhibitor.exhibitor_name}’s account on Financials and record what they have paid`}
          >
            Record a payment →
          </Link>
        </div>

        {/* What they asked for on the grounds, quoted verbatim. Read while the
            stall chart is being drawn, which is why it is a field of its own
            and not a sentence inside the general registration notes — the
            requests have to be findable together, and nothing here is a
            promise the app is making on the office's behalf. */}
        {(exhibitor.stall_request || exhibitor.arrival_date || exhibitor.departure_date) && (
          <div
            className="mt-3 rounded border px-3 py-2 text-sm"
            style={{ borderColor: COLORS.borderSoft, backgroundColor: COLORS.surfaceSoft }}
          >
            {exhibitor.stall_request && (
              <p style={{ color: COLORS.text }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.muted }}>
                  Stabling request
                </span>
                <span className="block whitespace-pre-wrap">{exhibitor.stall_request}</span>
              </p>
            )}
            {(exhibitor.arrival_date || exhibitor.departure_date) && (
              <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
                {exhibitor.arrival_date ? `Arriving ${exhibitor.arrival_date}` : 'Arrival not stated'}
                {' · '}
                {exhibitor.departure_date ? `leaving ${exhibitor.departure_date}` : 'departure not stated'}
              </p>
            )}
          </div>
        )}

        {/* Each line is its own jump link, to that horse's row rather than to
            the section: "No Coggins on file" over three horses is three
            different pieces of work, and the horse is named here because the
            row it lands on is the only place staff can act. */}
        {alerts.length > 0 && (
          <div className="mt-3 rounded px-3 py-2 text-sm" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
            {alerts.map((alert, i) => (
              <p key={`${alert.horse_id}-${alert.check.code}-${i}`}>
                ⚠{' '}
                <button
                  type="button"
                  onClick={() =>
                    jumpTo(
                      'paperwork',
                      anchorFor({
                        kind: 'horse_health_document',
                        horse_id: alert.horse_id,
                        document_type: alert.check.code,
                      }),
                    )
                  }
                  className="underline decoration-dotted hover:decoration-solid text-left"
                  style={{ color: 'var(--error-strong)' }}
                  title={`Go to ${alert.horse_name}’s ${alert.check.label} — sign off there if you have the paper in hand`}
                >
                  {alert.horse_name}: {alert.check.message} →
                </button>
              </p>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p
          className="text-sm px-3 py-2 rounded border"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      <Section
        title="Classes"
        collapsed={collapsed.has('classes')}
        onToggle={() => toggle('classes')}
        badge={
          <span
            className="text-xs text-right"
            style={{ color: COLORS.muted }}
            title="Class fees include any club sanction fee and show assessment charged per class. Futurity money is the category rate for each futurity class, plus the office fee and any late fee or membership. A side pot buy-in is charged once per pot, however many of its classes they entered."
          >
            {formatMoney(classFeesCents)} in class fees
            {(futurityCents > 0 || futurityLines.length > 0) && ` · ${formatMoney(futurityCents)} futurity`}
            {sidePotLines.length > 0 && ` · ${formatMoney(sidePotCents)} side pot`}
          </span>
        }
      >
        {exhibitor.entries.length === 0 ? (
          <p className="text-sm mb-3" style={{ color: COLORS.muted }}>Not entered in anything yet.</p>
        ) : (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: COLORS.accent }}>
                  <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Class</th>
                  <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                  <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Day</th>
                  <th className="text-right font-semibold pb-1 pr-3 whitespace-nowrap">Fee</th>
                  <th className="pb-1"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {exhibitor.entries.map((entry) => {
                  const cls = desk.classes.find((c) => c.id === entry.class_id);
                  const line = bill?.class_lines.find((l) => l.entry_id === entry.entry_id);
                  const futurity = futurityForClass(desk, entry.class_id);
                  const enrollment = futurity
                    ? futurityEnrollment(exhibitor, futurity.id, entry.horse_id)
                    : undefined;
                  return (
                    <tr key={entry.entry_id} className="border-t" style={{ borderColor: COLORS.borderSoft }}>
                      <td className="py-1.5 pr-3" style={{ color: COLORS.text }}>
                        <span className="font-mono" style={{ color: COLORS.accent }}>{entry.class_number}</span>{' '}
                        {entry.class_name}
                        {entry.is_disqualified && (
                          <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                            DQ
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3" style={{ color: COLORS.text }}>
                        {entry.horse_name ?? '(horse removed)'}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: COLORS.muted }}>
                        {entry.class_date
                          ? new Date(`${entry.class_date}T00:00:00`).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap" style={{ color: COLORS.muted }}>
                        {futurity ? (
                          enrollment ? (
                            <span title={`${futurity.name} — ${enrollment.fee_tier_name ?? 'enrolled'}`}>
                              {formatMoney(enrollment.tier_amount_cents)}
                              <span className="block text-xs">futurity</span>
                              {/* A futurity class is still the breed body's own
                                  class, so its per-class assessment lands here. */}
                              {(line?.charges ?? []).map((charge) => (
                                <span key={charge.show_fee_id} className="block text-xs">
                                  + {formatMoney(charge.cents)} {charge.label}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span
                              style={{ color: 'var(--warning)' }}
                              title={`Priced by ${futurity.name}, and this horse is not enrolled in it — see below`}
                            >
                              not enrolled
                            </span>
                          )
                        ) : line ? (
                          <span title={classFeeBreakdown(line)}>
                            {formatMoney(line.fee_cents + line.sanction_cents + (line.charge_cents ?? 0))}
                          </span>
                        ) : cls ? (
                          formatMoney(cls.entry_fee_cents)
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.entry_id, entry.class_id)}
                          disabled={busy.has(`entry-${entry.entry_id}`)}
                          /* Scratching the last class somebody holds in a pot
                             gives the buy-in back, which is money changing on a
                             press labelled "Remove" — so the press says so
                             first. Worked out the same way the backend does,
                             over this exhibitor's other entries. */
                          title={alsoReleasedIfRemoved(entry) || undefined}
                          className="text-xs hover:underline text-red-600 disabled:opacity-50"
                        >
                          {busy.has(`entry-${entry.entry_id}`) ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Each enrollment's arithmetic, as the bill charges it. Listed even
            with no futurity class entered: the office fee is still owed, and a
            stray enrollment is exactly what staff need to be able to see. */}
        {futurityLines.length > 0 && (
          <ul className="space-y-1 mb-3 text-xs" style={{ color: COLORS.muted }}>
            {futurityLines.map((l) => {
              const parts = [
                `${l.fee_tier_name ?? 'Enrolled'} ${formatMoney(l.tier_amount_cents)} × ${l.class_count} class${
                  l.class_count === 1 ? '' : 'es'
                }`,
                `${formatMoney(l.office_fee_cents)} office fee`,
              ];
              if (l.late_fee_cents > 0) parts.push(`${formatMoney(l.late_fee_cents)} late fee`);
              if (l.membership_fee_cents > 0) {
                parts.push(`${formatMoney(l.membership_fee_cents)} ${l.membership_name ?? 'membership'}`);
              }
              return (
                <li key={l.futurity_entry_id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>
                    <span style={{ color: COLORS.text }}>
                      {l.futurity_name} — {l.horse_name ?? 'horse removed'}
                    </span>
                    : {parts.join(' + ')}
                    {l.class_count === 0 && (
                      <span style={{ color: 'var(--warning)' }}> · not entered in any of its classes yet</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="whitespace-nowrap">{formatMoney(l.line_total_cents)}</span>
                    <WithdrawFuturityButton
                      showId={showId}
                      futurityId={l.futurity_id}
                      futurityName={l.futurity_name}
                      entryId={l.futurity_entry_id}
                      horseName={l.horse_name}
                      onWithdrawn={onChanged}
                    />
                    <Link
                      href={`/admin/shows/${showId}/futurities/${l.futurity_id}/entries`}
                      className="hover:underline whitespace-nowrap"
                      style={{ color: COLORS.accent }}
                      title="Change the category or the membership on this nomination"
                    >
                      Edit →
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* The buy-ins, which used to be shown by the panel's own Side Pots
            section. That section went when entering a bundled class became the
            buy-in, and this is where the money moved: onto the bill, next to the
            classes that caused it. Nothing to press — the way out is to scratch
            the classes, which releases it. */}
        {sidePotLines.length > 0 && (
          <ul className="space-y-1 mb-3 text-xs" style={{ color: COLORS.muted }}>
            {sidePotLines.map((l) => (
              <li key={l.side_pot_id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  <span style={{ color: COLORS.text }}>{l.name}</span>
                  {' '}buy-in · covers {l.class_count} class{l.class_count === 1 ? '' : 'es'}
                  {l.status !== 'open' && (
                    <span style={{ color: 'var(--warning)' }}> · {l.status}</span>
                  )}
                </span>
                <span className="whitespace-nowrap">
                  {formatMoney(l.line_total_cents)}{' '}
                  <Link
                    href={`/admin/shows/${showId}/side-pots/${l.side_pot_id}`}
                    className="hover:underline"
                    style={{ color: COLORS.accent }}
                    title="The pot's own screen — its roster, standings and payouts"
                  >
                    Pot →
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}

        {unenrolled.length > 0 && (
          <div className="space-y-2 mb-3">
            {unenrolled.map((row) => (
              <UnenrolledFuturityRow
                key={`${row.futurity.id}-${row.horseId}`}
                showId={showId}
                exhibitor={exhibitor}
                futurity={row.futurity}
                horseId={row.horseId}
                horseName={row.horseName}
                classCount={row.classCount}
                onEnrolled={onChanged}
              />
            ))}
          </div>
        )}

        <AddEntryForm
          showId={showId}
          desk={desk}
          exhibitor={exhibitor}
          onAdded={onChanged}
          key={`${exhibitor.exhibitor_id}-${horseListVersion}`}
        />
      </Section>

      <Section
        id={PAPERWORK_SECTION_ID}
        title="Paperwork"
        collapsed={collapsed.has('paperwork')}
        onToggle={() => toggle('paperwork')}
        hint="Sign off only for documents you have physically inspected. Each sign-off is recorded against the exact value on file at the time — if the exhibitor edits it afterwards, the check reappears as needing another look."
        badge={
          <span
            className="text-xs font-medium px-2 py-1 rounded-full"
            style={
              exhibitor.paperwork_outstanding === 0
                ? { backgroundColor: 'var(--success-border)', color: 'var(--success-strong)' }
                : { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }
            }
          >
            {exhibitor.paperwork_outstanding === 0
              ? 'All checked'
              : `${exhibitor.paperwork_outstanding} to check`}
          </span>
        }
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: COLORS.accent }}>
          Memberships
        </p>
        {exhibitor.memberships.length === 0 ? (
          // Not "this profile has none": the list is scoped to the bodies this
          // show runs under, so an Open show with no club sanctioning shows
          // nothing here however many cards the exhibitor holds. Saying the
          // profile is empty would send staff off to check a profile that is
          // fine.
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No memberships for this show to check.
          </p>
        ) : (
          exhibitor.memberships.map((check) => {
            const subject: Subject = {
              kind: 'exhibitor_membership',
              exhibitor_id: exhibitor.exhibitor_id,
              association_id: check.association_id,
            };
            return (
              <div key={check.association_id ?? 'none'} id={anchorFor(subject)}>
                <CheckRow
                  label={check.association_code ?? 'Membership'}
                  check={check}
                  busy={busy.has(subjectKey(subject))}
                  onVerify={() => verify(subject)}
                  onUndo={() => check.verification_id && undoVerify(subject, check.verification_id)}
                />
              </div>
            );
          })
        )}

        {/* Adding a horse lives under the Horses heading, where somebody looks
            for it — it used to sit at the foot of the whole Paperwork section,
            below the releases, where nobody did. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 mt-4 mb-1">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.accent }}>
            Horses
          </p>
          {!addingHorse && (
            <button
              type="button"
              onClick={() => setAddingHorse(true)}
              className="text-sm hover:underline"
              style={{ color: COLORS.accent }}
            >
              + Add a horse for {exhibitor.exhibitor_name}
            </button>
          )}
        </div>
        {addingHorse && (
          <div className="mb-3">
            <StaffAddHorseForm
              showId={showId}
              exhibitorId={exhibitor.exhibitor_id}
              exhibitorName={exhibitor.exhibitor_name}
              associations={associations}
              breeds={breeds}
              colors={colors}
              patterns={patterns}
              onCreated={async () => {
                setAddingHorse(false);
                // Straight into the class picker above: the reason someone adds
                // a horse at the desk is that they are about to enter it.
                setHorseListVersion((v) => v + 1);
                await onChanged();
              }}
              onCancel={() => setAddingHorse(false)}
            />
          </div>
        )}
        {/* A health row that is listed but not counted needs saying so, or it
            reads as a sign-off the desk has forgotten. This show takes the
            uploaded document as sufficient (setup Step 9); staff may still
            record a paper they are handed, and that still clears the flag. */}
        {!desk.requires_physical_document_check && (
          <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
            This show does not ask for health papers at the counter, so those sign-offs are
            optional and are not counted above.
          </p>
        )}
        {exhibitor.horses.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            Not entered on any horse yet — papers are checked once a horse is in a class.
          </p>
        ) : (
          <div className="space-y-3">
            {exhibitor.horses.map((horse) => (
              <div
                key={horse.horse_id}
                className="rounded border p-3"
                style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: COLORS.text }}>
                  {horse.horse_name}
                  {horse.barn_name && (
                    <span className="ml-2 font-normal text-xs" style={{ color: COLORS.muted }}>
                      &ldquo;{horse.barn_name}&rdquo;
                    </span>
                  )}
                </p>

                {(() => {
                  const showingHere =
                    openDocument !== null && openDocument.horseId === horse.horse_id;
                  const checks = (
                    <>
                      {(horse.health ?? []).map((check) => {
                        const subject: Subject = {
                          kind: 'horse_health_document',
                          horse_id: horse.horse_id,
                          document_type: check.code,
                        };
                        return (
                          <div key={check.code} id={anchorFor(subject)}>
                          <HealthCheckRow
                            check={check}
                            busy={busy.has(subjectKey(subject))}
                            viewing={
                              showingHere && openDocument?.documentType === check.code
                            }
                            paperworkDeadline={desk.paperwork_deadline}
                            onView={() =>
                              toggleDocument({
                                horseId: horse.horse_id,
                                documentType: check.code,
                                title: check.label,
                              })
                            }
                            onInspect={(attestedExpiry) =>
                              verify({ ...subject, attested_expiry: attestedExpiry })
                            }
                            onUndo={() =>
                              check.inspection?.verification_id &&
                              undoVerify(subject, check.inspection.verification_id)
                            }
                          />
                          </div>
                        );
                      })}

                      <div
                        className="flex items-center justify-between gap-2 pt-2 border-t"
                        style={{ borderColor: 'var(--bg-subtle)' }}
                      >
                        <span className="text-xs uppercase tracking-wide" style={{ color: COLORS.accent }}>
                          Registration papers
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            toggleDocument({
                              horseId: horse.horse_id,
                              documentType: REGISTRATION_PAPERS,
                              title: 'Registration papers',
                            })
                          }
                          aria-pressed={showingHere && openDocument?.documentType === REGISTRATION_PAPERS}
                          title="Show the uploaded papers beside the age and registration checks"
                          className="text-xs px-2 py-1 rounded border"
                          style={{
                            borderColor: COLORS.border,
                            backgroundColor:
                              showingHere && openDocument?.documentType === REGISTRATION_PAPERS
                                ? COLORS.dark
                                : COLORS.surface,
                            color:
                              showingHere && openDocument?.documentType === REGISTRATION_PAPERS
                                ? COLORS.onDark
                                : COLORS.accent,
                          }}
                        >
                          {showingHere && openDocument?.documentType === REGISTRATION_PAPERS
                            ? 'Hide'
                            : 'View'}
                        </button>
                      </div>

                      {(() => {
                        const subject: Subject = { kind: 'horse_age', horse_id: horse.horse_id };
                        return (
                          <div id={anchorFor(subject)}>
                            <CheckRow
                              label="Age (foaling date)"
                              check={horse.age_check}
                              busy={busy.has(subjectKey(subject))}
                              onVerify={() => verify(subject)}
                              onUndo={() =>
                                horse.age_check.verification_id &&
                                undoVerify(subject, horse.age_check.verification_id)
                              }
                            />
                          </div>
                        );
                      })()}

                      {horse.registrations.length === 0 ? (
                        // Scoped to the show's own associations, like the
                        // memberships above — a horse papered with four bodies
                        // shows none of them at a show that runs under none.
                        <p className="text-sm pt-2 border-t" style={{ borderColor: COLORS.borderSoft, color: COLORS.muted }}>
                          No registration papers for this show to check.
                        </p>
                      ) : (
                        horse.registrations.map((check) => {
                          const subject: Subject = {
                            kind: 'horse_registration',
                            horse_id: horse.horse_id,
                            association_id: check.association_id,
                          };
                          return (
                            <div key={check.association_id ?? 'none'} id={anchorFor(subject)}>
                              <CheckRow
                                label={`${check.association_code ?? 'Registration'} registration`}
                                check={check}
                                busy={busy.has(subjectKey(subject))}
                                onVerify={() => verify(subject)}
                                onUndo={() => check.verification_id && undoVerify(subject, check.verification_id)}
                              />
                            </div>
                          );
                        })
                      )}

                    </>
                  );

                  // Side by side once something is open, stacked otherwise. The
                  // checkbox and the scan have to be on screen together or the
                  // viewer is just a slower download.
                  if (!showingHere || !openDocument) return checks;
                  return (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="min-w-0">{checks}</div>
                      <div className="min-w-0">
                        <DocumentViewer
                          horseId={horse.horse_id}
                          horseName={horse.horse_name}
                          documentType={openDocument.documentType}
                          title={openDocument.title}
                          onClose={() => setOpenDocument(null)}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold uppercase tracking-wide mt-4 mb-1" style={{ color: COLORS.accent }}>
          Emergency contact
        </p>
        {editingContact ? (
          <div
            className="rounded border p-2 space-y-2"
            style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}
          >
            <div className="flex flex-wrap gap-2">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                aria-label="Emergency contact name"
                placeholder="Name"
                className="flex-1 min-w-[160px] border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
              />
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                aria-label="Emergency contact phone"
                placeholder="Phone"
                inputMode="tel"
                className="flex-1 min-w-[140px] border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
              />
            </div>
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Saved to {exhibitor.exhibitor_name}&rsquo;s profile, not just this show — it is who to
              telephone about them, and a per-show copy would go stale.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveEmergencyContact(contactName.trim(), contactPhone.trim())}
                disabled={busy.has('emergency-contact') || !contactName.trim() || !contactPhone.trim()}
                title={
                  !contactName.trim() || !contactPhone.trim()
                    ? 'A contact needs both a name and a number — one without the other still reads as missing'
                    : undefined
                }
                className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {busy.has('emergency-contact') ? 'Saving…' : 'Save contact'}
              </button>
              <button
                type="button"
                onClick={() => setEditingContact(false)}
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
              {exhibitor.emergency_contact?.status === 'on_file' && (
                <button
                  type="button"
                  onClick={() => saveEmergencyContact(null, null)}
                  disabled={busy.has('emergency-contact')}
                  title="Remove the contact from their profile"
                  className="text-xs hover:underline ml-auto disabled:opacity-50"
                  style={{ color: 'var(--error)' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        ) : exhibitor.emergency_contact?.status === 'on_file' ? (
          <p className="text-sm flex flex-wrap items-baseline gap-2" style={{ color: COLORS.text }}>
            {exhibitor.emergency_contact.name}
            <span className="font-mono text-xs" style={{ color: COLORS.muted }}>
              {exhibitor.emergency_contact.phone}
            </span>
            <button
              type="button"
              onClick={startEditingContact}
              className="text-xs hover:underline"
              style={{ color: COLORS.accent }}
            >
              Change
            </button>
          </p>
        ) : (
          <div className="text-sm rounded px-2 py-1.5" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
            No emergency contact on this profile.{' '}
            <button
              type="button"
              onClick={startEditingContact}
              className="font-medium underline"
              style={{ color: 'var(--warning)' }}
            >
              Take one now
            </button>{' '}
            — no need to wait for them to edit their own account.
          </div>
        )}

        {exhibitor.waivers && exhibitor.waivers.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide mt-4 mb-1" style={{ color: COLORS.accent }}>
              Entry blank &amp; releases
            </p>
            {exhibitor.waivers.map((waiver) => (
              <WaiverRow
                key={waiver.waiver_id}
                waiver={waiver}
                busy={busy.has(`waiver-${waiver.waiver_id}`)}
                onRecord={async (body) => {
                  await recordWaiver(waiver.waiver_id, body);
                }}
                onMarkOnFile={async () => {
                  await recordWaiver(waiver.waiver_id, {});
                }}
                onUndo={() => undoWaiver(waiver.waiver_id)}
              />
            ))}
          </>
        )}
      </Section>

      {/* The office's half of the two-week rule: an exhibitor may cancel their
          own registration up to a fortnight before the show, and inside that
          window this is the only door. Distinct from "Remove from this show"
          below, which deletes the registration outright — this one is for a
          registration that was real, and it keeps the row so the payments on
          it survive. */}
      {exhibitor.signed_up && !exhibitor.cancelled_at && exhibitor.show_entry_id && (
        <div className="text-sm">
          {confirmCancel ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)' }}
            >
              <p style={{ color: 'var(--error-strong)' }}>
                Cancel {exhibitor.exhibitor_name}&rsquo;s registration? This drops their{' '}
                {exhibitor.entries.length} class
                {exhibitor.entries.length === 1 ? '' : 'es'}, their stalls, shavings and camping,
                and any side pot or futurity entries. Payments already recorded stay on their
                account — refund those with a negative payment on Financials.
              </p>
              <input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={500}
                placeholder="Reason (optional)"
                aria-label="Cancellation reason"
                className="w-full border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)', color: COLORS.text }}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={cancelRegistration}
                  disabled={busy.has('cancel-registration')}
                  className="text-sm font-medium px-3 py-1.5 rounded disabled:opacity-50"
                  style={{ backgroundColor: 'var(--error)', color: 'var(--surface)' }}
                >
                  {busy.has('cancel-registration') ? 'Cancelling…' : 'Yes, cancel registration'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="text-sm hover:underline"
                  style={{ color: COLORS.muted }}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
              title="They are not coming. Drops their classes, stalls and pots; their payments stay for you to refund."
            >
              Cancel this registration
            </button>
          )}
        </div>
      )}

      {/* Removing takes the registration off the show entirely, however it got
          there — a self-registration included. Refused while payments are on
          the account, because the row carries them and a refund is a negative
          payment, never a deletion; the cancel above is the answer then. The
          backend enforces the same rule, and refuses on a placing or a settled
          pot as well. */}
      {exhibitor.show_entry_id && (
        <div className="text-sm">
          {confirmRemove ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)' }}
            >
              <p style={{ color: 'var(--error-strong)' }}>
                Remove {exhibitor.exhibitor_name} from this show?{' '}
                {exhibitor.cancelled_at
                  ? 'Their cancelled registration is deleted and they drop off the desk.'
                  : exhibitor.entries.length > 0 || potCount > 0
                    ? `This deletes their registration, their ${exhibitor.entries.length} class ${
                        exhibitor.entries.length === 1 ? 'entry' : 'entries'
                      }, stalls, shavings and camping, and any side pot or futurity entries.`
                    : 'This deletes their registration, along with any stalls, shavings or camping they booked.'}{' '}
                It cannot be undone{exhibitor.signed_up ? ' — they would have to sign up again' : ''}.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={removeFromRoster}
                  disabled={busy.has('remove-roster')}
                  className="text-sm font-medium px-3 py-1.5 rounded disabled:opacity-50"
                  style={{ backgroundColor: 'var(--error)', color: 'var(--surface)' }}
                >
                  {busy.has('remove-roster') ? 'Removing…' : 'Yes, remove from show'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="text-sm hover:underline"
                  style={{ color: COLORS.muted }}
                >
                  Keep them
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={exhibitor.payment_count > 0}
              className="text-xs hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
              style={{ color: COLORS.muted }}
              title={
                exhibitor.payment_count > 0
                  ? 'They have payments recorded, and removing the registration would delete them. Cancel the registration instead — it keeps the payments on their account to refund.'
                  : 'Delete this registration and everything it booked, as if they had never signed up.'
              }
            >
              Remove from this show
            </button>
          )}
        </div>
      )}
    </div>
  );
}
