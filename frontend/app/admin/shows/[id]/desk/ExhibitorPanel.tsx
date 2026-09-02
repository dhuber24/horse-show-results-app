'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AddEntryForm from './AddEntryForm';
import CheckRow, { type VerificationKind } from './CheckRow';
import DocumentViewer from './DocumentViewer';
import HealthCheckRow from './HealthCheckRow';
import StaffAddHorseForm, { type AssociationOption, type LookupOption } from './StaffAddHorseForm';
import WaiverRow from './WaiverRow';
import { COLORS, healthAlerts } from './types';
import type { Desk, DeskExhibitor } from './types';
import { formatMoney } from '@/lib/financials';

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

function Section({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4" style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: COLORS.accent }}>
          {title}
        </h3>
        {badge}
      </div>
      {hint && <p className="text-xs mb-3" style={{ color: COLORS.muted }}>{hint}</p>}
      {children}
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
  onChanged,
  onRemoved,
}: {
  showId: string;
  desk: Desk;
  exhibitor: DeskExhibitor;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
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

  const saveBackNumber = () =>
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
                back_number: backNumber.trim() === '' ? null : parseInt(backNumber, 10),
              },
            ],
          }),
        }),
      'Could not save that back number.',
    );

  const removeEntry = (entryId: string, classId: string) =>
    run(
      `entry-${entryId}`,
      () => fetch(`/api/entries/${entryId}?showId=${showId}&classId=${classId}`, { method: 'DELETE' }),
      'Could not remove that entry.',
    );

  const togglePot = (potId: string, isIn: boolean) => {
    if (!exhibitor.show_entry_id) return;
    if (isIn) {
      return run(
        `pot-${potId}`,
        async () => {
          // The pot's own entry id is not in the desk payload — it is only ever
          // needed at the moment someone is taken back out, so it is fetched
          // then rather than carried for every exhibitor on the roster.
          const listed = await fetch(`/api/shows/${showId}/side-pots/${potId}/entries`);
          if (!listed.ok) return listed;
          const rows: { id: string; show_entry_id: string }[] = await listed.json();
          const row = rows.find((r) => r.show_entry_id === exhibitor.show_entry_id);
          if (!row) return new Response(null, { status: 204 });
          return fetch(`/api/shows/${showId}/side-pots/${potId}/entries/${row.id}`, {
            method: 'DELETE',
          });
        },
        'Could not take them out of that pot.',
      );
    }
    return run(
      `pot-${potId}`,
      () =>
        fetch(`/api/shows/${showId}/side-pots/${potId}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show_entry_id: exhibitor.show_entry_id }),
        }),
      'Could not add them to that pot.',
    );
  };

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

  const recordWaiver = (
    waiverId: string,
    body: { signed_name: string; signed_by_guardian: boolean; guardian_relationship: string | null },
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
      'Could not take them off the roster.',
    );
    if (ok) onRemoved();
  };

  const alerts = healthAlerts(exhibitor);
  const potCount = exhibitor.side_pot_ids.length;
  const backNumberDirty = (exhibitor.back_number?.toString() ?? '') !== backNumber.trim();

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
                <p className="text-xs mt-1 text-center" style={{ color: '#92400e' }}>
                  asked for {exhibitor.preferred_back_number}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={saveBackNumber}
              disabled={!backNumberDirty || busy.has('back-number')}
              title={backNumberDirty ? undefined : 'The number on screen is the one on file'}
              className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: COLORS.accent, color: '#ffffff' }}
            >
              {busy.has('back-number') ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 pt-3 border-t text-sm" style={{ borderColor: COLORS.borderSoft }}>
          <span style={{ color: COLORS.muted }}>
            {exhibitor.entries.length} class{exhibitor.entries.length === 1 ? '' : 'es'}
          </span>
          {desk.side_pots.length > 0 && (
            <span style={{ color: COLORS.muted }}>
              {potCount} side pot{potCount === 1 ? '' : 's'}
            </span>
          )}
          <span style={{ color: exhibitor.paperwork_outstanding > 0 ? '#92400e' : '#2f6b3f' }}>
            {exhibitor.paperwork_outstanding > 0
              ? `${exhibitor.paperwork_outstanding} paperwork check${exhibitor.paperwork_outstanding === 1 ? '' : 's'} outstanding`
              : 'Paperwork all checked'}
          </span>
          {/* The panel's only money figures. Paid is here because billed and
              owing alone cannot answer "how much have they already given us?",
              which is the question being asked when somebody is standing at
              the counter with a chequebook. */}
          <span style={{ color: exhibitor.balance_cents > 0 ? '#b42318' : COLORS.muted }}>
            {formatMoney(exhibitor.billed_cents)} billed · {formatMoney(exhibitor.net_paid_cents)} paid
            {' · '}
            {formatMoney(exhibitor.balance_cents)} owing
          </span>
          <Link
            href={`/admin/shows/${showId}/financials/exhibitors`}
            className="hover:underline"
            style={{ color: COLORS.accent }}
            title="Take money against this show's exhibitor accounts"
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

        {alerts.length > 0 && (
          <div className="mt-3 rounded px-3 py-2 text-sm" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
            {alerts.map((c, i) => (
              <p key={`${c.code}-${i}`}>⚠ {c.message}</p>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p
          className="text-sm px-3 py-2 rounded border"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}
        >
          {error}
        </p>
      )}

      <Section
        title="Classes"
        badge={
          <span className="text-xs" style={{ color: COLORS.muted }}>
            {formatMoney(exhibitor.entries.reduce(
              (sum, e) => sum + (desk.classes.find((c) => c.id === e.class_id)?.entry_fee_cents ?? 0),
              0,
            ))} in class fees
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
                        {cls ? formatMoney(cls.entry_fee_cents) : '—'}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.entry_id, entry.class_id)}
                          disabled={busy.has(`entry-${entry.entry_id}`)}
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

        <AddEntryForm
          showId={showId}
          desk={desk}
          exhibitor={exhibitor}
          onAdded={onChanged}
          key={`${exhibitor.exhibitor_id}-${horseListVersion}`}
        />
      </Section>

      {desk.side_pots.length > 0 && (
        <Section
          title="Side pots"
          hint={
            exhibitor.show_entry_id
              ? 'Buy-ins settle with this exhibitor’s show bill at the end of the show, so being in a pot is what owing the buy-in means. They are not part of the billed and owing figures above — pot money is reported separately on Financials.'
              : undefined
          }
        >
          {!exhibitor.show_entry_id ? (
            <p className="text-sm" style={{ color: COLORS.muted }}>
              Give this exhibitor a back number first — a side pot entry hangs off their show
              roster row.
            </p>
          ) : (
            <ul className="space-y-2">
              {desk.side_pots.map((pot) => {
                const isIn = exhibitor.side_pot_ids.includes(pot.id);
                const settled = pot.status === 'settled';
                return (
                  <li key={pot.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: COLORS.text }}>
                        {pot.name}
                        {settled && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#e5e7eb', color: '#374151' }}>
                            settled
                          </span>
                        )}
                      </p>
                      <p className="text-xs" style={{ color: COLORS.muted }}>
                        {formatMoney(pot.entry_fee_cents)} buy-in · {pot.entry_count} in
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePot(pot.id, isIn)}
                      disabled={settled || busy.has(`pot-${pot.id}`)}
                      title={settled ? 'This pot is settled and cannot be changed' : undefined}
                      className="text-xs font-medium px-3 py-1.5 rounded border shrink-0 disabled:opacity-50"
                      style={
                        isIn
                          ? { backgroundColor: COLORS.accent, borderColor: COLORS.accent, color: '#ffffff' }
                          : { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.accent }
                      }
                    >
                      {busy.has(`pot-${pot.id}`) ? '…' : isIn ? '✓ In the pot' : 'Add to pot'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <Section
        title="Paperwork"
        hint="Sign off only for documents you have physically inspected. Each sign-off is recorded against the exact value on file at the time — if the exhibitor edits it afterwards, the check reappears as needing another look."
        badge={
          <span
            className="text-xs font-medium px-2 py-1 rounded-full"
            style={
              exhibitor.paperwork_outstanding === 0
                ? { backgroundColor: '#d1fae5', color: '#065f46' }
                : { backgroundColor: '#fef3c7', color: '#92400e' }
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
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No association memberships on this profile.
          </p>
        ) : (
          exhibitor.memberships.map((check) => {
            const subject: Subject = {
              kind: 'exhibitor_membership',
              exhibitor_id: exhibitor.exhibitor_id,
              association_id: check.association_id,
            };
            return (
              <CheckRow
                key={check.association_id ?? 'none'}
                label={check.association_code ?? 'Membership'}
                check={check}
                busy={busy.has(subjectKey(subject))}
                onVerify={() => verify(subject)}
                onUndo={() => check.verification_id && undoVerify(subject, check.verification_id)}
              />
            );
          })
        )}

        <p className="text-xs font-semibold uppercase tracking-wide mt-4 mb-1" style={{ color: COLORS.accent }}>
          Horses
        </p>
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
                style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fffdf9' }}
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
                          <HealthCheckRow
                            key={check.code}
                            check={check}
                            busy={busy.has(subjectKey(subject))}
                            viewing={
                              showingHere && openDocument?.documentType === check.code
                            }
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
                        );
                      })}

                      <div
                        className="flex items-center justify-between gap-2 pt-2 border-t"
                        style={{ borderColor: '#f0e6d6' }}
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
                        );
                      })()}

                      {horse.registrations.length === 0 ? (
                        <p className="text-sm pt-2 border-t" style={{ borderColor: COLORS.borderSoft, color: COLORS.muted }}>
                          No registration numbers on file for this horse.
                        </p>
                      ) : (
                        horse.registrations.map((check) => {
                          const subject: Subject = {
                            kind: 'horse_registration',
                            horse_id: horse.horse_id,
                            association_id: check.association_id,
                          };
                          return (
                            <CheckRow
                              key={check.association_id ?? 'none'}
                              label={`${check.association_code ?? 'Registration'} registration`}
                              check={check}
                              busy={busy.has(subjectKey(subject))}
                              onVerify={() => verify(subject)}
                              onUndo={() => check.verification_id && undoVerify(subject, check.verification_id)}
                            />
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
            style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fffdf9' }}
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
                style={{ backgroundColor: '#8b4513' }}
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
                  style={{ color: '#b42318' }}
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
          <div className="text-sm rounded px-2 py-1.5" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
            No emergency contact on this profile.{' '}
            <button
              type="button"
              onClick={startEditingContact}
              className="font-medium underline"
              style={{ color: '#92400e' }}
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
                onUndo={() => undoWaiver(waiver.waiver_id)}
              />
            ))}
          </>
        )}

        {addingHorse ? (
          <div className="mt-3">
            <StaffAddHorseForm
              showId={showId}
              exhibitorId={exhibitor.exhibitor_id}
              exhibitorName={exhibitor.exhibitor_name}
              associations={associations}
              breeds={breeds}
              colors={colors}
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
        ) : (
          <button
            type="button"
            onClick={() => setAddingHorse(true)}
            className="mt-3 text-sm hover:underline"
            style={{ color: COLORS.accent }}
          >
            + Add a horse for {exhibitor.exhibitor_name}
          </button>
        )}
      </Section>

      {/* The office's half of the two-week rule: an exhibitor may cancel their
          own registration up to a fortnight before the show, and inside that
          window this is the only door. Distinct from "Take off the roster"
          below, which is the undo for adding the wrong person — this one is
          for a registration that was real, and it keeps the row so the
          payments on it survive. */}
      {exhibitor.signed_up && !exhibitor.cancelled_at && exhibitor.show_entry_id && (
        <div className="text-sm">
          {confirmCancel ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2' }}
            >
              <p style={{ color: '#991b1b' }}>
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
                style={{ borderColor: COLORS.border, backgroundColor: '#ffffff', color: COLORS.text }}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={cancelRegistration}
                  disabled={busy.has('cancel-registration')}
                  className="text-sm font-medium px-3 py-1.5 rounded disabled:opacity-50"
                  style={{ backgroundColor: '#b42318', color: '#ffffff' }}
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

      {/* Only ever an undo for adding the wrong person: the backend refuses
          once entries, pots, reservations, or payments exist. */}
      {!exhibitor.signed_up &&
        exhibitor.entries.length === 0 &&
        potCount === 0 &&
        exhibitor.show_entry_id && (
          <div className="text-sm">
            {confirmRemove ? (
              <span className="flex items-center gap-2 flex-wrap">
                <span style={{ color: '#5c3d1e' }}>
                  Take {exhibitor.exhibitor_name} off this show&rsquo;s roster?
                </span>
                <button
                  type="button"
                  onClick={removeFromRoster}
                  disabled={busy.has('remove-roster')}
                  className="text-sm font-medium px-3 py-1 rounded disabled:opacity-50"
                  style={{ backgroundColor: '#b42318', color: '#ffffff' }}
                >
                  {busy.has('remove-roster') ? 'Removing…' : 'Yes, remove'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="text-sm hover:underline"
                  style={{ color: COLORS.muted }}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
                title="Added the wrong person? They have nothing on file yet, so this can be undone."
              >
                Take off the roster
              </button>
            )}
          </div>
        )}
    </div>
  );
}
