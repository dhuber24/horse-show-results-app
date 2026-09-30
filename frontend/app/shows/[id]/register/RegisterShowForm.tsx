'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { errorMessage } from '@/lib/api-error';
import { formatMoney, type PreviewData } from './types';

/**
 * Signing up for one show, as a wizard.
 *
 * Up to five steps, in order, each one a collapsible box with a stepper across
 * the top — the exhibitor's answer to the wizard a show manager gets while
 * setting a show up. Three of them are conditional, so the stepper is built
 * from data rather than from a fixed list:
 *
 * 1. **Your details.** Contact details, date of birth, an emergency contact —
 *    and a parent or guardian when the exhibitor is under 18 on the show's
 *    first day. The office used to reach a stall chart before it had
 *    somebody's telephone number, and nobody goes back afterwards to fill that
 *    in.
 *
 *    Steps one to three open on the exhibitor's profile and **never write it**
 *    (migration 145): a detail, a membership or a horse changed here is
 *    changed for this show only. Removing a horse on this screen used to take
 *    it off the profile.
 * 2. **Your association memberships.** The exhibitor's own cards. Only at a
 *    show with a breed or club affiliation to hold one against, and it blocks
 *    nothing — see `MembershipsStep`.
 * 3. **Your horses.** What you are bringing, whether its papers suit the body
 *    running this show, and how you are entitled to show it.
 * 4. **Stalls, shavings & camping.** Only at a show that sells any of them. At
 *    a show whose Lodging step was skipped or left empty there is nothing to
 *    book, so the step is not offered at all and the horses step's own button
 *    is the sign-up.
 * 5. **Futurities.** Only at a show that runs one.
 *
 * **Classes are not a step any more.** They are the page this wizard hands off
 * to once sign-up is done (`ClassEntryScreen`, `/shows/[id]/register/classes`),
 * and My Shows has a button of its own for them: signing up is done once, while
 * classes are added and dropped for weeks, and coming back to add the Saturday
 * used to mean walking through every box above to reach the last one. The
 * stepper still ends in **Classes**, as a link, so the journey reads whole.
 *
 * **Futurities come after the grounds**, because a futurity enrollment adds a
 * line to the bill (`billing.futurity_lines`) and books its own classes — so
 * the total under the class page is the whole of what the show will collect.
 *
 * **One screen rather than five routes**, which is where this departs from the
 * setup wizard it otherwise mirrors. A show manager builds a show over a
 * fortnight from a desk; an exhibitor signs up in a sitting, on a phone,
 * watching a bill.
 *
 * **Every lock is a rule the backend enforces, not a rule this screen invents.**
 * `PUT /signup` refuses on the same profile checklist steps one and two render,
 * and class entries, back numbers and futurity nominations all 409 without a
 * completed sign-up. The lock exists so nobody fills in a form that is going to
 * be turned away, never as the thing doing the turning away.
 *
 * Every figure comes from `billing.build_bill` on the backend. Nothing here is
 * summed in the browser; see the money Sharp Edge in Claude.md.
 */

type StepKey = 'details' | 'memberships' | 'horses' | 'stalls' | 'futurities' | 'classes';

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
  const { show, exhibitor, horses, bill, profile } = preview;
  const signedUp = preview.signup !== null;
  const classesHref = `/shows/${showId}/register/classes`;

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
  // Whether there is a stalls step. The backend's answer where it sent one;
  // otherwise the fee catalogue's, and a catalogue that failed to load keeps
  // the step, which then says so — a show that sells stalls must never lose
  // the only place they are booked over a failed request.
  const hasLodging =
    show.offers_lodging ?? (signupData ? signupData.fee_options.length > 0 : true);
  // The exhibitor's own association cards, a step of their own. Absent
  // entirely when the show has no breed or club affiliation to hold a
  // membership against — `exhibitor_profile.py` omits the row, and an Open
  // show with no clubs is not waiting on anybody's card.
  const membershipItem = profile.checklist.find((i) => i.key === 'memberships');
  const entered = bill.class_lines;

  // Bookmark this show as one they started (migration 136). The first three
  // steps read the profile and write nothing against the show until something
  // in them is changed, so without this a registration abandoned before
  // sign-up leaves no trace at all and My Shows has nothing to remind them with.
  //
  // Fire and forget, and silent on failure by design: it is a beacon on a page
  // load rather than something the exhibitor asked for. The endpoint is
  // idempotent and no-ops for anyone already signed up; the guard here only
  // saves the round trip.
  useEffect(() => {
    if (signedUp) return;
    fetch(`/api/shows/${showId}/register/draft`, { method: 'POST' }).catch(() => {});
  }, [showId, signedUp]);

  // Signing up from the horses step, at a show with no stalls step. The same
  // `PUT /signup` the stalls form sends, with nothing booked — which is all a
  // sign-up at such a show can be.
  const [signingUp, setSigningUp] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  // Where the wizard goes once sign-up is behind it: the futurity step where
  // the show runs one, the class page otherwise.
  const afterSignup = () => {
    if (hasFuturities) {
      go('futurities');
      router.refresh();
    } else {
      router.push(classesHref);
    }
  };

  const signUpWithoutLodging = async () => {
    setSigningUp(true);
    setSignupError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/signup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservations: [] }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail = (json as { detail?: { message?: unknown } } | null)?.detail;
        setSignupError(
          typeof detail?.message === 'string'
            ? detail.message
            : errorMessage(json, 'Could not sign you up for this show.'),
        );
        setSigningUp(false);
        return;
      }
      setSigningUp(false);
      afterSignup();
    } catch {
      setSignupError('Network error — please try again.');
      setSigningUp(false);
    }
  };

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

  const classesSummary = [
    entered.length === 0
      ? 'No classes entered'
      : `${entered.length} class${entered.length === 1 ? '' : 'es'} entered`,
    preview.signup?.back_number != null ? `Back #${preview.signup.back_number}` : 'No back # yet',
  ].join(' · ');

  // Why the steps after sign-up are shut, said the same way wherever it shows.
  const signupLockReason = hasLodging ? 'Sign up for stalls first' : 'Sign up on the horses step first';

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
      // At a show with no stalls step, pressing on from here is the sign-up,
      // so the tick waits for it — a green step with the sign-up still to do
      // reads as a registration that is finished.
      done: horsesDone && (hasLodging || signedUp),
      available: detailsDone,
      lockedReason: 'Finish your details first',
    },
    ...(hasLodging
      ? [
          {
            key: 'stalls' as StepKey,
            label: 'Stalls',
            done: signedUp,
            available: profileComplete,
            lockedReason: 'Add a horse first',
          },
        ]
      : []),
    ...(hasFuturities
      ? [
          {
            key: 'futurities' as StepKey,
            label: 'Futurities',
            done: futurities.some((f) => f.my_entries.length > 0),
            available: signedUp,
            lockedReason: signupLockReason,
          },
        ]
      : []),
    // Not a section on this screen: the class page. On the stepper so the
    // journey reads whole and so it can be reached from here.
    {
      key: 'classes',
      label: 'Classes',
      done: entered.length > 0,
      available: signedUp,
      lockedReason: signupLockReason,
    },
  ];

  // Whichever step still needs doing is the one that opens. A first-time
  // registrant lands on their details; somebody coming back signed up lands on
  // nothing open, with the class page one press away below.
  //
  // Memberships is deliberately not in this chain even when it is outstanding.
  // It blocks nothing, and a wizard that opens on an optional step is telling
  // somebody they have to do it.
  const derivedStep: StepKey | null = !detailsDone
    ? 'details'
    : !horsesDone
      ? 'horses'
      : !signedUp
        ? hasLodging
          ? 'stalls'
          : 'horses'
        : null;
  // `?step=` wins, because it means somebody was sent away from this screen and
  // is being brought back to the box they left — the add-a-horse wizard is six
  // steps on another route. Validated against the sections actually on this
  // screen, so a hand-typed or stale value falls back to the derived answer.
  const requestedStep = searchParams.get('step');
  const initialStep: StepKey | null =
    requestedStep &&
    requestedStep !== 'classes' &&
    steps.some((s) => s.key === requestedStep)
      ? (requestedStep as StepKey)
      : derivedStep;
  const [openStep, setOpenStep] = useState<StepKey | null>(initialStep);

  const stepNumber = (key: StepKey) => steps.findIndex((s) => s.key === key) + 1;
  function go(key: StepKey | null) {
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
  }
  const toggle = (key: StepKey) => setOpenStep((current) => (current === key ? null : key));

  // The horses step's Next. With a stalls step it simply moves on; without one
  // it is the sign-up, and after sign-up it carries on to whatever is left.
  const horsesNext = (() => {
    if (hasLodging) return { label: 'Next', onNext: () => go('stalls') };
    if (!signedUp) {
      return {
        label: signingUp ? 'Signing up…' : 'Sign up & continue',
        onNext: signUpWithoutLodging,
      };
    }
    return hasFuturities
      ? { label: 'Next', onNext: () => go('futurities') }
      : { label: 'Enter classes', onNext: () => router.push(classesHref) };
  })();

  return (
    <div className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
        My registration — {exhibitor.full_name}
      </p>

      <div className="mt-4">
        <RegistrationStepper
          steps={steps}
          current={openStep ?? (signedUp ? 'classes' : 'details')}
          onSelect={(key) => (key === 'classes' ? router.push(classesHref) : go(key as StepKey))}
        />
      </div>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        {/* Says what to do next rather than describing the screen. Somebody
            halfway through needs to be told which step they are on, not read a
            paragraph about all of them. */}
        {!detailsDone
          ? 'Start with your details — the rest opens up once they’re in.'
          : !horsesDone
            ? 'Next: the horses you’re bringing.'
            : !signedUp
              ? hasLodging
                ? 'Next: stalls, shavings and camping — that signs you up and opens class entry.'
                : 'Next: Sign up & continue, under your horses — that opens class entry.'
              : 'You’re signed up. Enter your classes below, and open any step here to change it up until the show starts.'}
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
            // Saved to this show's registration, never to the profile.
            showId={showId}
            // A minor is judged on the show's first day, as the backend does.
            asOf={show.start_date}
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
              showId={showId}
              exhibitorId={exhibitor.id}
              registrations={preview.registrations}
              item={membershipItem}
              ownCopy={profile.own_copy?.memberships ?? false}
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
          done={horsesDone && (hasLodging || signedUp)}
          isOpen={openStep === 'horses'}
          onToggle={() => toggle('horses')}
          locked={!detailsDone}
          lockedReason="Finish your details first"
          onBack={() => go(membershipItem ? 'memberships' : 'details')}
          onNext={horsesNext.onNext}
          nextLabel={horsesNext.label}
          nextBusy={signingUp}
          nextDisabledReason={horsesDone ? null : 'Add a horse to carry on.'}
        >
          <HorsesStep
            showId={showId}
            horses={horses}
            otherProfileHorses={preview.other_profile_horses ?? []}
            // Only a show whose association asks. Elsewhere it is a field with
            // no reader, and a form that asks for what nothing consumes is how
            // people learn to skim past the questions that matter.
            needsRelationship={show.show_type_code === 'APHA'}
            showTypeCode={show.show_type_code}
          />
          {signupError && (
            <div
              className="mt-3 rounded-lg border p-3 text-sm"
              style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
            >
              {signupError}
            </div>
          )}
        </RegistrationSection>
      </div>

      {hasLodging && (
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
                // Saving the first time is the sign-up, and carries on to the
                // futurities or the classes. A later save is somebody changing
                // a stall count, who is not asking to be sent anywhere.
                onSaved={() => {
                  if (!signedUp) {
                    afterSignup();
                  } else {
                    go(null);
                    router.refresh();
                  }
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
      )}

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
            lockedReason={signupLockReason}
            onBack={() => go(hasLodging ? 'stalls' : 'horses')}
            onNext={() => router.push(classesHref)}
            nextLabel="Enter classes"
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

      {/* The hand-off to the class page, where the wizard used to have its last
          step. Shut until sign-up, with the reason, the same as a locked step —
          class entries 409 without one (`SHOW_SIGNUP_REQUIRED`). */}
      <section
        id="registration-classes"
        className="mt-4 rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        style={{
          borderColor: signedUp ? 'var(--accent)' : 'var(--border)',
          backgroundColor: 'var(--surface)',
        }}
      >
        <span className="min-w-0">
          <span
            className="block font-semibold"
            style={{ color: signedUp ? 'var(--foreground)' : 'var(--text-dimmed)' }}
          >
            <span aria-hidden="true" className="mr-1.5">
              📝
            </span>
            Classes &amp; back number
          </span>
          <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {signedUp ? classesSummary : signupLockReason}
          </span>
        </span>
        {signedUp && (
          <Link
            href={classesHref}
            className="text-sm font-medium px-4 py-2 rounded text-white shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {entered.length === 0 ? 'Enter classes →' : 'Add or drop classes →'}
          </Link>
        )}
      </section>

      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          What this show will cost
        </h2>
        {/* Every step lands in here — classes, the grounds, the office charge
            and any futurity — from the same `build_bill` the office reads and
            the same one on What I Owe, so the three cannot disagree. */}
        <ShowBillBreakdown bill={bill} />
        {/* Everywhere else this screen sends you, in one place under the bill. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t text-sm font-medium"
          style={{ borderColor: 'var(--border-subtle)' }}>
          <Link
            href={`/shows/${showId}/showbill`}
            className="hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Show bill &amp; fee schedule →
          </Link>
          <Link
            href={`/shows/${showId}/schedule`}
            className="hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Browse the full class schedule →
          </Link>
          <Link href="/my-shows" className="hover:underline" style={{ color: 'var(--accent)' }}>
            All my shows →
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
          offersLodging={hasLodging}
        />
      )}
    </div>
  );
}
