'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BackNumberRequest from './BackNumberRequest';
import AddClassEntry from './AddClassEntry';
import ProfileStep from './ProfileStep';
import MembershipsStep from './MembershipsStep';
import HorsesStep from './HorsesStep';
import CancelRegistration from './CancelRegistration';
import FuturityEntry, { futuritySummary, type ExhibitorFuturity } from './FuturityEntry';
import RegistrationSection from './RegistrationSection';
import RegistrationStepper, { type RegistrationStep } from './RegistrationStepper';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import ReservationFields, {
  reservationSummary,
  type SignupData,
} from '../_components/ReservationFields';
import { formatMoney, healthWarnings, type PreviewData } from './types';
import type { BillClassLine } from '@/lib/my-shows';

/**
 * Everything an exhibitor signs up for at one show, as a wizard.
 *
 * Up to six steps, in order, each one a collapsible box with a stepper across
 * the top — the exhibitor's answer to the wizard a show manager gets while
 * setting a show up. Two of them are conditional, so the stepper is built from
 * data rather than from a fixed list:
 *
 * 1. **Your details.** Contact details, date of birth, an emergency contact.
 *    The office used to reach a stall chart before it had somebody's telephone
 *    number, and nobody goes back afterwards to fill that in.
 * 2. **Your association memberships.** The exhibitor's own cards. Only at a
 *    show with a breed or club affiliation to hold one against, and it blocks
 *    nothing — see `MembershipsStep`.
 * 3. **Your horses.** What you are bringing, whether its papers suit the body
 *    running this show, and how you are entitled to show it. All three are
 *    questions about the horse, and none of them belongs on a form about the
 *    person.
 * 4. **Stalls, shavings & camping.** The show needs its grounds counts before
 *    it has a ring full of horses.
 * 5. **Futurities.** Only at a show that runs one.
 * 6. **Classes & back number.** What you are entered in and the number you
 *    want to ride under.
 *
 * **Futurities come before the classes**, which is not where they started. A
 * futurity enrollment adds a line to the bill (`billing.futurity_lines`) and
 * its classes are ordinary classes entered in the step below it — so asking
 * afterwards meant somebody read a running total under the class picker that
 * was about to change. In this order the total under the last step is the whole
 * of what the show will collect.
 *
 * **One screen rather than six routes**, which is where this departs from the
 * setup wizard it otherwise mirrors. A show manager builds a show over a
 * fortnight from a desk; an exhibitor enters one in a sitting, on a phone,
 * watching a bill. Separate routes would put a page load between every answer
 * and hide the running total behind all of them — so every box stays on the
 * page and the bill sits under all of it.
 *
 * **Every lock is a rule the backend enforces, not a rule this screen invents.**
 * `PUT /signup` refuses on the same profile checklist steps one and two render,
 * and class entries and back numbers both 409 without a completed sign-up. The
 * lock exists so nobody fills in a form that is going to be turned away, never
 * as the thing doing the turning away.
 *
 * Every figure comes from `billing.build_bill` on the backend — including the
 * futurity lines, which is why entering a futurity adds a line to the total
 * below rather than a number this screen worked out. Nothing here is summed in
 * the browser; see the money Sharp Edge in Claude.md.
 */

type StepKey = 'details' | 'memberships' | 'horses' | 'stalls' | 'classes' | 'futurities';

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
    <tr className="border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
      <td className="py-1.5 pr-3" style={{ color: 'var(--foreground)' }}>
        <span className="font-mono" style={{ color: 'var(--accent)' }}>{line.class_number}</span>{' '}
        {line.class_name}
      </td>
      <td className="py-1.5 pr-3" style={{ color: 'var(--foreground)' }}>
        {line.horse_name ?? '(horse removed)'}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {line.class_date ? formatDay(line.class_date) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap" style={{ color: 'var(--muted)' }}>
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
              style={{ backgroundColor: 'var(--error)' }}
            >
              {isRemoving ? 'Removing…' : 'Yes, remove'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isRemoving}
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: 'var(--muted)' }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onAsk}
            className="text-xs hover:underline"
            style={{ color: 'var(--error)' }}
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
   *  show runs none, in which case the step is not offered at all. */
  futurities: ExhibitorFuturity[];
  /** From `GET /shows/{id}/register/signup` — the fee catalogue with this
   *  exhibitor's own rates on it. Null only when that call failed, in which
   *  case the stalls step says so rather than pretending the show published no
   *  fees. */
  signupData: SignupData | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show, exhibitor, classes, horses, existing_entries, bill, profile } = preview;
  const signedUp = preview.signup !== null;

  // The two halves of the profile, kept apart because they are two steps. Both
  // answers are the backend's — `exhibitor_profile.py` tags every row with the
  // step that asks for it, so a step cannot go green over an item `PUT /signup`
  // is still refusing on.
  const detailsMissing = profile.checklist.filter(
    (i) => i.step === 'details' && i.blocking && !i.complete,
  );
  const detailsDone = detailsMissing.length === 0;
  const horsesDone = horses.length > 0;
  const profileComplete = profile.complete;
  const hasFuturities = futurities.length > 0;
  // The exhibitor's own association cards, now a step of their own rather than
  // a link out of step one. Absent entirely when the show has no breed or club
  // affiliation to hold a membership against — `exhibitor_profile.py` omits the
  // row, and an Open show with no clubs is not waiting on anybody's card — in
  // which case the step is not rendered, the same rule futurities follow.
  const membershipItem = profile.checklist.find((i) => i.key === 'memberships');

  // Bookmark this show as one they started (migration 136). The first three
  // steps write their profile and their horses, neither of which belongs to
  // this weekend, so without this a registration abandoned before sign-up
  // leaves no trace at all and My Shows has nothing to remind them with.
  //
  // Fire and forget, and silent on failure by design: it is a beacon on a page
  // load rather than something the exhibitor asked for, and a red box about a
  // failed bookmark would be the screen complaining about its own bookkeeping.
  // The endpoint is idempotent and no-ops for anyone already signed up; the
  // guard here only saves the round trip.
  useEffect(() => {
    if (signedUp) return;
    fetch(`/api/shows/${showId}/register/draft`, { method: 'POST' }).catch(() => {});
  }, [showId, signedUp]);

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
        horsesNeedingRecords.length === 1
          ? '1 horse needs records'
          : `${horsesNeedingRecords.length} horses need records`,
      );
    }
    return parts.join(' · ');
  })();

  const detailsSummary = detailsDone
    ? 'On file'
    : `Still needed: ${detailsMissing.map((i) => i.label).join(', ').toLowerCase()}`;

  const horsesSummary = (() => {
    if (horses.length === 0) return 'None yet';
    const flagged = horses.filter((h) => (h.registration_flags ?? []).length > 0).length;
    const parts = [`${horses.length} horse${horses.length === 1 ? '' : 's'}`];
    if (flagged > 0) {
      parts.push(`${flagged} missing papers`);
    }
    return parts.join(' · ');
  })();

  // Folded, this line is the whole step. The count first because that is what
  // somebody is checking, then the hint — which is the backend's own, and
  // names the associations still outstanding rather than saying how many.
  const membershipsSummary = (() => {
    if (!membershipItem) return '';
    const n = preview.registrations.length;
    const held = n === 0 ? 'None on file' : `${n} on file`;
    return `${held} · ${membershipItem.hint}`;
  })();

  const stallsSummary = (() => {
    if (!signupData) return 'Stalls, shavings and camping';
    const { total_cents, parts } = reservationSummary(signupData);
    if (parts.length === 0) return signedUp ? 'Nothing reserved' : 'Not signed up yet';
    return `${parts.join(' · ')} — ${formatMoney(total_cents)}`;
  })();

  const steps: (RegistrationStep & { key: StepKey })[] = [
    { key: 'details', label: 'Your details', done: detailsDone, available: true },
    // Between the person and their horses, because it is the person's own
    // card — a *horse's* papers with the same association are a different fact
    // and are asked about on the next step. Never gates the one after it:
    // the membership row is advisory, so `horses` stays available on
    // `detailsDone` exactly as it did before this step existed.
    ...(membershipItem
      ? [
          {
            key: 'memberships' as StepKey,
            label: 'Memberships',
            done: membershipItem.complete,
            available: detailsDone,
            lockedReason: 'Finish your details first',
          },
        ]
      : []),
    {
      key: 'horses',
      label: 'Your horses',
      done: horsesDone,
      available: detailsDone,
      lockedReason: 'Finish your details first',
    },
    {
      key: 'stalls',
      label: 'Stalls',
      done: signedUp,
      available: profileComplete,
      lockedReason: 'Add a horse first',
    },
    // Before the classes, not after them. A futurity enrollment adds a line to
    // the bill (`billing.futurity_lines`) and its classes are ordinary classes
    // entered in the step below — so somebody who entered their classes first
    // and only then found the futurity had already read a total that was about
    // to change. Asking in this order means the running total under the classes
    // step is the whole of what the show will collect.
    ...(hasFuturities
      ? [
          {
            key: 'futurities' as StepKey,
            label: 'Futurities',
            done: futurities.some((f) => f.my_entries.length > 0),
            available: signedUp,
            lockedReason: 'Sign up for stalls first',
          },
        ]
      : []),
    {
      key: 'classes',
      label: 'Classes',
      done: entered.length > 0,
      available: signedUp,
      lockedReason: 'Sign up for stalls first',
    },
  ];

  // Whichever step still needs doing is the one that opens. A first-time
  // registrant lands on their details; somebody coming back lands on their
  // classes, which is what they returned for.
  //
  // Memberships is deliberately not in this chain even when it is outstanding.
  // It blocks nothing, and a wizard that opens on an optional step is telling
  // somebody they have to do it.
  const derivedStep: StepKey = !detailsDone
    ? 'details'
    : !horsesDone
      ? 'horses'
      : !signedUp
        ? 'stalls'
        : 'classes';
  // `?step=` wins, because it means somebody was sent away from this screen and
  // is being brought back to the box they left — the add-a-horse wizard is six
  // steps on another route, and returning them to whatever the checklist thinks
  // is outstanding would land them somewhere they did not leave. Validated
  // against the steps actually on offer, so a hand-typed or stale value falls
  // back to the derived answer rather than opening nothing at all.
  const requestedStep = searchParams.get('step');
  const initialStep: StepKey =
    requestedStep && steps.some((s) => s.key === requestedStep)
      ? (requestedStep as StepKey)
      : derivedStep;
  const [openStep, setOpenStep] = useState<StepKey | null>(initialStep);

  const stepNumber = (key: StepKey) => steps.findIndex((s) => s.key === key) + 1;
  const go = (key: StepKey | null) => {
    setOpenStep(key);
    if (key) {
      // The header of the step being opened, not the top of the page: on a
      // phone the box below the one you just finished is otherwise off-screen.
      requestAnimationFrame(() => {
        document
          .getElementById(`registration-${key}`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };
  const toggle = (key: StepKey) => setOpenStep((current) => (current === key ? null : key));

  return (
    <div className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
        My registration — {exhibitor.full_name}
      </p>

      <div className="mt-4">
        <RegistrationStepper
          steps={steps}
          current={openStep ?? 'details'}
          onSelect={(key) => go(key as StepKey)}
        />
      </div>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        {/* Says what to do next rather than describing the screen. Somebody
            halfway through needs to be told which step they are on, not read a
            paragraph about all five. */}
        {!detailsDone
          ? 'Start with your details — the rest opens up once they’re in.'
          : !horsesDone
            ? 'Next: the horses you’re bringing.'
            : !signedUp
              ? 'Next: stalls, shavings and camping — that opens up class entries.'
              : 'Open any step to change it, up until the show starts. Fees shown here are what the office will collect at the show.'}
      </div>

      <div id="registration-details">
        <RegistrationSection
          step={stepNumber('details')}
          title="Your details"
          icon="👤"
          summary={detailsSummary}
          done={detailsDone}
          isOpen={openStep === 'details'}
          onToggle={() => toggle('details')}
        >
          {/* No Next in the section footer: the step's own "Save & continue"
              is the Next, because a Next that did not save would advance past
              boxes nobody had written down. */}
          <ProfileStep
            profile={profile}
            // The memberships step carries this now, so step one no longer
            // ends in a link out to /profile for it.
            hasMembershipsStep={membershipItem !== undefined}
            onSaved={() => go(membershipItem ? 'memberships' : 'horses')}
          />
        </RegistrationSection>
      </div>

      {membershipItem && (
        <div id="registration-memberships">
          <RegistrationSection
            step={stepNumber('memberships')}
            title="Your association memberships"
            icon="🎫"
            summary={membershipsSummary}
            done={membershipItem.complete}
            isOpen={openStep === 'memberships'}
            onToggle={() => toggle('memberships')}
            locked={!detailsDone}
            lockedReason="Finish your details first"
            onBack={() => go('details')}
            onNext={() => go('horses')}
          >
            <MembershipsStep
              exhibitorId={exhibitor.id}
              registrations={preview.registrations}
              item={membershipItem}
            />
          </RegistrationSection>
        </div>
      )}

      <div id="registration-horses">
        <RegistrationSection
          step={stepNumber('horses')}
          title="Your horses"
          icon="🐴"
          summary={horsesSummary}
          done={horsesDone}
          isOpen={openStep === 'horses'}
          onToggle={() => toggle('horses')}
          locked={!detailsDone}
          lockedReason="Finish your details first"
          onBack={() => go(membershipItem ? 'memberships' : 'details')}
          onNext={() => go('stalls')}
          nextDisabledReason={horsesDone ? null : 'Add a horse to carry on.'}
        >
          <HorsesStep
            showId={showId}
            exhibitorId={exhibitor.id}
            horses={horses}
            // Only a show whose association asks. Elsewhere it is a field with
            // no reader, and a form that asks for what nothing consumes is how
            // people learn to skim past the questions that matter.
            needsRelationship={show.show_type_code === 'APHA'}
            showTypeCode={show.show_type_code}
          />
        </RegistrationSection>
      </div>

      <div id="registration-stalls">
        <RegistrationSection
          step={stepNumber('stalls')}
          title="Stalls, shavings & camping"
          icon="🏠"
          summary={stallsSummary}
          done={signedUp}
          isOpen={openStep === 'stalls'}
          onToggle={() => toggle('stalls')}
          locked={!profileComplete}
          lockedReason={!detailsDone ? 'Finish your details first' : 'Add a horse first'}
          onBack={() => go('horses')}
        >
          {signupData ? (
            <ReservationFields
              showId={showId}
              data={signupData}
              submitLabel={signedUp ? 'Save changes' : 'Sign up & continue'}
              totalHint="Class fees are counted separately, in the total below."
              // Saving is what unlocks the two steps below it, so it is also
              // what advances into the first of them. A show that runs a
              // futurity asks about it before the classes, so the bill under
              // the class picker is the whole of what the show will collect.
              onSaved={() => {
                go(hasFuturities ? 'futurities' : 'classes');
                router.refresh();
              }}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Stall, shavings and camping options could not be loaded for this show.{' '}
              <Link
                href={`/shows/${showId}/signup`}
                className="font-medium hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                Try the sign-up page →
              </Link>
            </p>
          )}
        </RegistrationSection>
      </div>

      {/* A step of its own rather than a card hanging below the wizard, because
          a futurity is a separate programme with its own deadline and its own
          money — and the bill below counts it. Not offered at all when the show
          runs none. */}
      {hasFuturities && (
        <div id="registration-futurities">
          <RegistrationSection
            step={stepNumber('futurities')}
            title="Futurities"
            icon="🏆"
            summary={futuritySummary(futurities)}
            done={futurities.some((f) => f.my_entries.length > 0)}
            isOpen={openStep === 'futurities'}
            onToggle={() => toggle('futurities')}
            locked={!signedUp}
            lockedReason="Sign up for stalls first"
            onBack={() => go('stalls')}
            onNext={() => go('classes')}
          >
            <FuturityEntry
              showId={showId}
              futurities={futurities}
              horses={horses.map((h) => ({ id: h.id, name: h.name }))}
              signedUp={signedUp}
            />
          </RegistrationSection>
        </div>
      )}


      <div id="registration-classes">
        <RegistrationSection
          step={stepNumber('classes')}
          title="Classes & back number"
          icon="📝"
          summary={classesSummary}
          done={entered.length > 0}
          isOpen={openStep === 'classes'}
          onToggle={() => toggle('classes')}
          locked={!signedUp}
          lockedReason="Sign up for stalls first"
          onBack={() => go(hasFuturities ? 'futurities' : 'stalls')}
          footerNote={
            // Classes are the one step somebody legitimately leaves half done:
            // the schedule is not always out, and people come back a week
            // later to add the Saturday. Everything already entered is saved
            // as it goes, so leaving costs nothing — this just says so, and
            // gives them the door.
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Entries save as you add them.{' '}
              <Link href="/my-shows" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                Finish later from My Shows →
              </Link>
            </span>
          }
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
              <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                {entered.length === 0
                  ? 'Your classes'
                  : `You're entered in ${entered.length} class${entered.length === 1 ? '' : 'es'}`}
              </h3>
              {entered.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {/* The per-class sanction money only — it is part of what
                      each class below costs. A club charging per horse or per
                      exhibitor (migration 133) is not a class fee and is in
                      the bill further down, with its arithmetic. */}
                  {formatMoney(
                    bill.class_fee_total_cents + bill.class_sanction_total_cents,
                  )}{' '}
                  in class fees
                </span>
              )}
            </div>

            {horses.length === 0 ? (
              <div
                className="rounded-lg border p-3 text-sm"
                style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
              >
                No horses on your profile yet — add one on the horses step above.
              </div>
            ) : (
              <>
                {entered.length === 0 ? (
                  <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                    Nothing entered yet — pick a class below.
                  </p>
                ) : (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
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
                style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
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
              style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
                {horsesNeedingRecords.length === 1
                  ? '1 horse needs'
                  : `${horsesNeedingRecords.length} horses need`}{' '}
                health records updated before the show
              </p>
              <p className="text-xs" style={{ color: 'var(--warning)' }}>
                You can still enter — the office expects current paperwork when you ship in.
              </p>
              <ul className="space-y-1.5">
                {horsesNeedingRecords.map((h) => {
                  const warnings = healthWarnings(h);
                  return (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                    >
                      <span style={{ color: 'var(--warning-strong)' }}>
                        <span className="font-medium">{h.name}</span>
                        {' — '}
                        {warnings[0] ?? 'documents needed'}
                      </span>
                      <Link
                        href={`/profile/horses/${h.id}`}
                        className="shrink-0 text-xs font-medium hover:underline"
                        style={{ color: 'var(--accent)' }}
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
      </div>

      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          What this show will cost
        </h2>
        {/* Every step lands in here — classes, the grounds, the office charge
            and any futurity — from the same `build_bill` the office reads and
            the same one on My Shows, so the three cannot disagree. */}
        <ShowBillBreakdown bill={bill} />
        {/* Everywhere else this screen sends you, in one place under the bill. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t text-sm font-medium"
          style={{ borderColor: 'var(--border-subtle)' }}>
          <Link
            href={`/shows/${showId}/details`}
            className="hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Show details &amp; show bill →
          </Link>
          <Link
            href={`/shows/${showId}/schedule`}
            className="hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Browse the full class schedule →
          </Link>
          <Link href="/my-shows" className="hover:underline" style={{ color: 'var(--accent)' }}>
            My shows &amp; bill →
          </Link>
        </div>
      </section>

      {/* Last on the page and only once there is something to cancel. Under
          the bill on purpose: the figure somebody is looking at when they
          decide to withdraw is what they would owe, and the confirm step says
          what happens to anything already paid. */}
      {signedUp && (
        <CancelRegistration
          showId={showId}
          window={preview.cancellation}
          entryCount={entered.length}
        />
      )}
    </div>
  );
}
