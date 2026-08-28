'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BackNumberRequest from './BackNumberRequest';
import AddClassEntry from './AddClassEntry';
import FuturityEntry, { type ExhibitorFuturity } from './FuturityEntry';
import RegistrationSection from './RegistrationSection';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import ReservationFields, {
  reservationSummary,
  type SignupData,
} from '../_components/ReservationFields';
import { formatMoney, healthWarnings, type PreviewData } from './types';
import type { BillClassLine } from '@/lib/my-shows';

/**
 * Everything an exhibitor signs up for at one show, on one screen.
 *
 * Two foldable halves. **Classes & back number** is the counter flow — what you
 * are entered in, the number you want to ride under, one form to enter the next
 * class, and the horses whose paperwork the office will chase. **Stalls,
 * shavings & camping** is what used to be a separate `/signup` page you were
 * redirected through before you were allowed to pick a class.
 *
 * They were split because they are two backend calls. That is not a distinction
 * an exhibitor should have to care about: somebody entering a show is doing one
 * thing, and being bounced between two screens to finish it is how people end
 * up signed up with no classes, or with six stalls and no idea what they cost.
 * Both halves are here, both fold — the whole thing open at once is a very long
 * page on the phone most people fill this in on — and the bill underneath
 * counts all of it.
 *
 * The sign-up rule is still real: class entries and back numbers both 409
 * without a completed sign-up, so until then the classes half stays shut and
 * says which section to fill in first. `/shows/[id]/signup` survives as the
 * door people are sent to, and renders the same `ReservationFields`.
 *
 * Every figure comes from `billing.build_bill` on the backend. Nothing here is
 * summed in the browser — see the money Sharp Edge in Claude.md.
 */

function formatDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * One class already entered, with the control to get back out of it.
 *
 * The desk removes an entry outright — a secretary is standing in front of the
 * person asking for it. This one confirms inline first: it is the exhibitor's
 * own money, usually on a phone, and an accidental tap that quietly drops them
 * from a class is not something they would notice until the gate.
 */
function EnteredRow({
  line,
  isConfirming,
  isRemoving,
  onAsk,
  onCancel,
  onConfirm,
}: {
  line: BillClassLine;
  isConfirming: boolean;
  isRemoving: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <tr className="border-t" style={{ borderColor: '#f0e4d0' }}>
      <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>
        <span className="font-mono" style={{ color: '#8b4513' }}>{line.class_number}</span>{' '}
        {line.class_name}
      </td>
      <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>
        {line.horse_name ?? '(horse removed)'}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: '#8b7355' }}>
        {line.class_date ? formatDay(line.class_date) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap" style={{ color: '#8b7355' }}>
        {formatMoney(line.fee_cents + line.sanction_cents)}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {isConfirming ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isRemoving}
              className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: '#b91c1c' }}
            >
              {isRemoving ? 'Removing…' : 'Yes, remove'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isRemoving}
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: '#8b7355' }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onAsk}
            className="text-xs hover:underline"
            style={{ color: '#b91c1c' }}
            title={`Remove ${line.horse_name ?? 'this horse'} from ${line.class_name}`}
            aria-label={`Remove ${line.horse_name ?? 'this horse'} from ${line.class_name}`}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

export default function RegisterShowForm({
  showId,
  preview,
  futurities,
  signupData,
}: {
  showId: string;
  preview: PreviewData;
  /** The show's futurities with this exhibitor's enrollments; empty when the
   *  show runs none, in which case the section renders nothing. */
  futurities: ExhibitorFuturity[];
  /** From `GET /shows/{id}/register/signup` — the fee catalogue with this
   *  exhibitor's own rates on it. Null only when that call failed, in which
   *  case the stalls half says so rather than pretending the show published no
   *  fees. */
  signupData: SignupData | null;
}) {
  const router = useRouter();
  const { show, exhibitor, classes, horses, existing_entries, bill } = preview;
  const signedUp = preview.signup !== null;

  // Whichever half still needs doing is the one that opens. A first-time
  // registrant lands on stalls, because that is the half that unlocks the
  // other; everyone after that lands on their classes, which is what they came
  // back for.
  const [openClasses, setOpenClasses] = useState(signedUp);
  const [openStalls, setOpenStalls] = useState(!signedUp);

  const [confirmWithdrawEntryId, setConfirmWithdrawEntryId] = useState<string | null>(null);
  const [withdrawingEntryId, setWithdrawingEntryId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const horsesNeedingRecords = useMemo(
    () => horses.filter((h) => healthWarnings(h).length > 0),
    [horses],
  );

  const handleWithdraw = async (entryId: string) => {
    setWithdrawError(null);
    setWithdrawingEntryId(entryId);
    try {
      const res = await fetch(`/api/shows/${showId}/register/entries/${entryId}`, {
        method: 'DELETE',
      });
      if (res.status !== 204 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail = typeof json?.detail === 'string'
          ? json.detail
          : json?.detail?.message || json?.error || 'Withdraw failed';
        setWithdrawError(detail);
        setWithdrawingEntryId(null);
        return;
      }
      setConfirmWithdrawEntryId(null);
      setWithdrawingEntryId(null);
      router.refresh();
    } catch {
      setWithdrawError('Network error — please try again.');
      setWithdrawingEntryId(null);
    }
  };

  const entered = bill.class_lines;

  // Folded, these lines are the only thing on screen saying what you have.
  const classesSummary = (() => {
    const parts: string[] = [
      entered.length === 0
        ? 'No classes entered'
        : `${entered.length} class${entered.length === 1 ? '' : 'es'}`,
      preview.signup?.back_number != null
        ? `Back #${preview.signup.back_number}`
        : 'No back # yet',
    ];
    if (horsesNeedingRecords.length > 0) {
      parts.push(
        `${horsesNeedingRecords.length} horse${
          horsesNeedingRecords.length === 1 ? '' : 's'
        } need records`,
      );
    }
    return parts.join(' · ');
  })();

  const stallsSummary = (() => {
    if (!signupData) return 'Stalls, shavings and camping';
    const { total_cents, parts } = reservationSummary(signupData);
    if (parts.length === 0) return signedUp ? 'Nothing reserved' : 'Not signed up yet';
    return `${parts.join(' · ')} — ${formatMoney(total_cents)}`;
  })();

  return (
    <div className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
        My registration — {exhibitor.full_name}
      </p>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        {signedUp
          ? 'Everything you sign up for at this show is on this screen. Open a section to change it — you can keep changing until the show starts. Fees are informational; the show office collects payment at the show.'
          : 'Start with stalls, shavings and camping: that tells the office you’re coming and opens up class entries. Fees are informational — the show office collects payment at the show.'}
      </div>

      <RegistrationSection
        title="Classes & back number"
        icon="📝"
        summary={classesSummary}
        isOpen={openClasses}
        onToggle={() => setOpenClasses((v) => !v)}
        locked={!signedUp}
        lockedReason="Sign up below first — the office needs your stall numbers before you can enter classes"
      >
        {/* First inside on purpose: people who ride the same number every year
            come here to claim it, and burying it under the class table would
            mean they only remember at the desk. */}
        <BackNumberRequest
          showId={showId}
          backNumber={preview.signup?.back_number ?? null}
          preferredBackNumber={preview.signup?.preferred_back_number ?? null}
        />

        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold" style={{ color: '#2c1810' }}>
              {entered.length === 0
                ? 'Your classes'
                : `You're entered in ${entered.length} class${entered.length === 1 ? '' : 'es'}`}
            </h3>
            {entered.length > 0 && (
              <span className="text-xs" style={{ color: '#8b7355' }}>
                {formatMoney(bill.class_fee_total_cents + bill.sanction_total_cents)} in class
                fees
              </span>
            )}
          </div>

          {horses.length === 0 ? (
            <div
              className="rounded-lg border p-3 text-sm"
              style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
            >
              You don&apos;t have any horses on your profile yet. Add one before entering classes —
              your stall and camping numbers can be set either way.
              <div className="mt-2">
                <Link href="/profile" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
                  Manage my horses →
                </Link>
              </div>
            </div>
          ) : (
            <>
              {entered.length === 0 ? (
                <p className="text-sm mb-3" style={{ color: '#8b7355' }}>
                  Not entered in anything yet. Pick your first class below.
                </p>
              ) : (
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide" style={{ color: '#8b4513' }}>
                        <th className="text-left font-semibold pb-1 pr-3">Class</th>
                        <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                        <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Day</th>
                        <th className="text-right font-semibold pb-1 pr-3 whitespace-nowrap">Fee</th>
                        <th className="pb-1"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entered.map((line) => (
                        <EnteredRow
                          key={line.entry_id}
                          line={line}
                          isConfirming={confirmWithdrawEntryId === line.entry_id}
                          isRemoving={withdrawingEntryId === line.entry_id}
                          onAsk={() => {
                            setConfirmWithdrawEntryId(line.entry_id);
                            setWithdrawError(null);
                          }}
                          onCancel={() => {
                            setConfirmWithdrawEntryId(null);
                            setWithdrawError(null);
                          }}
                          onConfirm={() => handleWithdraw(line.entry_id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <AddClassEntry
                showId={showId}
                showTypeCode={show.show_type_code}
                classes={classes}
                horses={horses}
                existingEntries={existing_entries}
                onAdded={() => router.refresh()}
              />
            </>
          )}

          {withdrawError && (
            <div
              className="mt-3 rounded-lg border p-3 text-sm"
              style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
            >
              {withdrawError}
            </div>
          )}
        </div>

        {/* Advisory, never a gate — the entry goes in either way and the office
            gets the same list with time to chase it. In here rather than at the
            top of the page because it is about the horses in the table above
            it. */}
        {horsesNeedingRecords.length > 0 && (
          <div
            className="mt-4 rounded-lg border p-3 space-y-2"
            style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}
          >
            <p className="text-sm font-medium" style={{ color: '#92400e' }}>
              {horsesNeedingRecords.length === 1
                ? '1 horse needs'
                : `${horsesNeedingRecords.length} horses need`}{' '}
              health records updated before the show
            </p>
            <p className="text-xs" style={{ color: '#92400e' }}>
              You can still enter these classes now. The show office is sent the same list and will
              expect current paperwork by the time you ship in.
            </p>
            <ul className="space-y-1.5">
              {horsesNeedingRecords.map((h) => {
                const warnings = healthWarnings(h);
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: '#7c2d12' }}>
                      <span className="font-medium">{h.name}</span>
                      {' — '}
                      {warnings[0] ?? 'documents needed'}
                    </span>
                    <Link
                      href={`/profile/horses/${h.id}`}
                      className="shrink-0 text-xs font-medium hover:underline"
                      style={{ color: '#8b4513' }}
                    >
                      Upload documents →
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </RegistrationSection>

      <RegistrationSection
        title="Stalls, shavings & camping"
        icon="🏠"
        summary={stallsSummary}
        isOpen={openStalls}
        onToggle={() => setOpenStalls((v) => !v)}
      >
        {signupData ? (
          <ReservationFields
            showId={showId}
            data={signupData}
            submitLabel={signedUp ? 'Save changes' : 'Sign up for this show'}
            totalHint="Class fees are counted separately, in the total below."
            // Already on the right screen, so refresh in place — and open the
            // classes half, which this save is what unlocks.
            onSaved={() => {
              setOpenClasses(true);
              router.refresh();
            }}
          />
        ) : (
          <p className="text-sm" style={{ color: '#8b7355' }}>
            Stall, shavings and camping options could not be loaded for this show.{' '}
            <Link
              href={`/shows/${showId}/signup`}
              className="font-medium hover:underline"
              style={{ color: '#8b4513' }}
            >
              Try the sign-up page →
            </Link>
          </p>
        )}
      </RegistrationSection>

      {/* Outside the collapsible sections on purpose: a futurity is a separate
          program with its own deadline, and folding it away would hide the one
          thing on this screen that expires. Renders nothing when the show runs
          no futurity. */}
      <FuturityEntry
        showId={showId}
        futurities={futurities}
        horses={horses.map((h) => ({ id: h.id, name: h.name }))}
        signedUp={signedUp}
      />

      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>
          What this show will cost
        </h2>
        {/* Both halves land in here — the same bill the office reads and the
            same one on My Shows, so the three cannot disagree. */}
        <ShowBillBreakdown bill={bill} />
        {/* Everywhere else this screen sends you, in one place under the bill. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t text-sm font-medium"
          style={{ borderColor: '#e8d5b7' }}>
          <Link
            href={`/shows/${showId}/schedule`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Browse the full class schedule →
          </Link>
          <Link href={`/shows/${showId}`} className="hover:underline" style={{ color: '#8b4513' }}>
            Back to the show →
          </Link>
          <Link href="/my-shows" className="hover:underline" style={{ color: '#8b4513' }}>
            My shows &amp; bill →
          </Link>
        </div>
      </section>
    </div>
  );
}
