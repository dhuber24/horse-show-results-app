'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BackNumberRequest from './BackNumberRequest';
import AddClassEntry from './AddClassEntry';
import ProfileStep from './ProfileStep';
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
 * Five steps, in order, each one a collapsible box with a stepper across the
 * top — the exhibitor's answer to the wizard a show manager gets while setting
 * a show up:
 *
 * 1. **Your details.** Contact details, date of birth, an emergency contact.
 *    The office used to reach a stall chart before it had somebody's telephone
 *    number, and nobody goes back afterwards to fill that in.
 * 2. **Your horses.** What you are bringing, whether its papers suit the body
 *    running this show, and how you are entitled to show it. All three are
 *    questions about the horse, and none of them belongs on a form about the
 *    person.
 * 3. **Stalls, shavings & camping.** The show needs its grounds counts before
 *    it has a ring full of horses.
 * 4. **Classes & back number.** What you are entered in and the number you
 *    want to ride under.
 * 5. **Futurities.** Only at a show that runs one.
 *
 * **One screen rather than five routes**, which is where this departs from the
 * setup wizard it otherwise mirrors. A show manager builds a show over a
 * fortnight from a desk; an exhibitor enters one in a sitting, on a phone,
 * watching a bill. Five routes would put a page load between every answer and
 * hide the running total behind all of them — so every box stays on the page
 * and the bill sits under all of it.
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

type StepKey = 'details' | 'horses' | 'stalls' | 'classes' | 'futurities';

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
   *  show runs none, in which case the step is not offered at all. */
  futurities: ExhibitorFuturity[];
  /** From `GET /shows/{id}/register/signup` — the fee catalogue with this
   *  exhibitor's own rates on it. Null only when that call failed, in which
   *  case the stalls step says so rather than pretending the show published no
   *  fees. */
  signupData: SignupData | null;
}) {
  const router = useRouter();
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

  // Whichever step still needs doing is the one that opens. A first-time
  // registrant lands on their details; somebody coming back lands on their
  // classes, which is what they returned for.
  const initialStep: StepKey = !detailsDone
    ? 'details'
    : !horsesDone
      ? 'horses'
      : !signedUp
        ? 'stalls'
        : 'classes';
  const [openStep, setOpenStep] = useState<StepKey | null>(initialStep);

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

  const detailsSummary = detailsDone
    ? 'Contact details, date of birth and emergency contact on file'
    : `${detailsMissing.length} thing${detailsMissing.length === 1 ? '' : 's'} still needed: ${
        detailsMissing.map((i) => i.label).join(', ').toLowerCase()
      }`;

  const horsesSummary = (() => {
    if (horses.length === 0) return 'No horses on your profile yet';
    const flagged = horses.filter((h) => (h.registration_flags ?? []).length > 0).length;
    const parts = [`${horses.length} horse${horses.length === 1 ? '' : 's'}`];
    if (flagged > 0) {
      parts.push(`${flagged} without the papers this show asks for`);
    }
    return parts.join(' · ');
  })();

  const stallsSummary = (() => {
    if (!signupData) return 'Stalls, shavings and camping';
    const { total_cents, parts } = reservationSummary(signupData);
    if (parts.length === 0) return signedUp ? 'Nothing reserved' : 'Not signed up yet';
    return `${parts.join(' · ')} — ${formatMoney(total_cents)}`;
  })();

  const steps: (RegistrationStep & { key: StepKey })[] = [
    { key: 'details', label: 'Your details', done: detailsDone, available: true },
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
      lockedReason: 'Finish your details and add a horse first',
    },
    {
      key: 'classes',
      label: 'Classes',
      done: entered.length > 0,
      available: signedUp,
      lockedReason: 'Reserve your stalls, shavings and camping first',
    },
    ...(hasFuturities
      ? [
          {
            key: 'futurities' as StepKey,
            label: 'Futurities',
            done: futurities.some((f) => f.my_entries.length > 0),
            available: signedUp,
            lockedReason: 'Reserve your stalls, shavings and camping first',
          },
        ]
      : []),
  ];

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
      <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
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
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        {/* Says what to do next rather than describing the screen. Somebody
            halfway through needs to be told which step they are on, not read a
            paragraph about all five. */}
        {!detailsDone
          ? 'Start with your details — the show office needs them before it can take your entry. Everything below opens up once they’re in.'
          : !horsesDone
            ? 'Next: the horses you’re bringing. You enter classes on a horse from your profile.'
            : !signedUp
              ? 'Next: stalls, shavings and camping. That tells the office you’re coming and opens up class entries. Fees are informational — the show office collects payment at the show.'
              : 'Everything you sign up for at this show is on this screen. Open a step to change it — you can keep changing until the show starts. Fees are informational; the show office collects payment at the show.'}
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
          <ProfileStep profile={profile} onSaved={() => go('horses')} />
        </RegistrationSection>
      </div>

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
          lockedReason="Finish your details above first"
          onBack={() => go('details')}
          onNext={() => go('stalls')}
          nextDisabledReason={
            horsesDone ? null : 'Add at least one horse — you enter classes on a horse from your profile.'
          }
        >
          <HorsesStep
            showId={showId}
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
          lockedReason={
            !detailsDone
              ? 'Finish your details above first — the show office needs them before it can hold a stall for you'
              : 'Add a horse above first'
          }
          onBack={() => go('horses')}
        >
          {signupData ? (
            <ReservationFields
              showId={showId}
              data={signupData}
              submitLabel={signedUp ? 'Save changes' : 'Sign up & continue'}
              totalHint="Class fees are counted separately, in the total below."
              // Saving is what unlocks the classes step, so it is also what
              // advances to it.
              onSaved={() => {
                go('classes');
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
      </div>

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
          lockedReason="Reserve your stalls, shavings and camping above first — the office needs those numbers before you can enter classes"
          onBack={() => go('stalls')}
          onNext={hasFuturities ? () => go('futurities') : undefined}
          footerNote={
            // Classes are the one step somebody legitimately leaves half done:
            // the schedule is not always out, and people come back a week
            // later to add the Saturday. Everything already entered is saved
            // as it goes, so leaving costs nothing — this just says so, and
            // gives them the door.
            <span className="text-xs" style={{ color: '#8b7355' }}>
              Entered classes save as you add them.{' '}
              <Link href="/my-shows" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
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
                You don&apos;t have any horses on your profile yet. Add one on the horses step
                above before entering classes.
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
            lockedReason="Complete your show sign-up above first"
            onBack={() => go('classes')}
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

      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>
          What this show will cost
        </h2>
        {/* Every step lands in here — classes, the grounds, the office charge
            and any futurity — from the same `build_bill` the office reads and
            the same one on My Shows, so the three cannot disagree. */}
        <ShowBillBreakdown bill={bill} />
        {/* Everywhere else this screen sends you, in one place under the bill. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t text-sm font-medium"
          style={{ borderColor: '#e8d5b7' }}>
          <Link
            href={`/shows/${showId}/details`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Show details &amp; show bill →
          </Link>
          <Link
            href={`/shows/${showId}/schedule`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Browse the full class schedule →
          </Link>
          <Link href="/my-shows" className="hover:underline" style={{ color: '#8b4513' }}>
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
