'use client';

import { useState } from 'react';
import ExhibitorRegistrations, { type Registration } from '@/components/ExhibitorRegistrations';
import { coatDescription } from '@/lib/horse-coat';
import AddHorseWizard from '../profile/AddHorseWizard';
import type { MyHorse } from '../profile/horse-shared';
import ProfileStep from '../shows/[id]/register/ProfileStep';
import type { ProfileStatus } from '../shows/[id]/register/types';
import StepHeading from './StepHeading';

/** A scan of a membership card, filed on the profile beside its number. */
interface Certificate {
  id: string;
  document_type: string;
  original_filename: string;
  issue_date: string | null;
  expiry_date: string | null;
  association_id: string | null;
}

type Step = 'details' | 'memberships' | 'horses';
const STEPS: Step[] = ['details', 'memberships', 'horses'];

const PRIMARY_BUTTON = 'px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50';
const FOOTNOTE = 'text-xs';

/**
 * Setting up an exhibitor profile: the person, their memberships, their horses.
 *
 * An exhibitor's account form asks for a name, an email and a password, and
 * this is where they land next. Without it a new exhibitor reached the home
 * page holding a profile with nothing on it, and the first screen that asked
 * for a phone number or a horse was the first show they tried to enter — and
 * that screen saves to the show's own copy (migration 145), so a profile left
 * empty stayed empty, and was asked for again at the next show.
 *
 * **Every step can be skipped**, and nothing records that one was. A show asks
 * for whatever it needs when it is entered, and `/profile` holds all three
 * afterwards, so "later" is a real answer; standing between somebody and the
 * show they came to look at is not. Skipping the details keeps what was typed
 * (`ProfileStep`'s `onSkip`).
 *
 * **Each step writes the profile through the endpoint its own screen uses** —
 * `ProfileStep` without a show, `ExhibitorRegistrations` on the profile's
 * list, `AddHorseWizard` as `/profile/horses/new` runs it — so these boxes
 * never disagree with My Account. The horse wizard is opened in place rather
 * than linked to: a six-step detour on another route is how somebody loses
 * their place in this one.
 *
 * **All three steps stay mounted**, the ones not in view hidden, so *Back*
 * returns to what was typed rather than re-reading props the server rendered
 * before any of it was saved.
 *
 * Also the second half of a show official's questionnaire when they tick
 * *I also compete* — `stepsBefore` numbers these after theirs.
 */
export default function ExhibitorSetup({
  exhibitor,
  initialRegistrations,
  initialCertificates,
  initialHorses,
  destination,
  stepsBefore = 0,
}: {
  exhibitor: ProfileStatus['exhibitor'];
  initialRegistrations: Registration[];
  initialCertificates: Certificate[];
  initialHorses: MyHorse[];
  /** Where finishing goes — `?next=`, or the first thing an exhibitor came to do. */
  destination: string;
  /** Steps the caller asked before these, for the "Step 2 of 4" count. */
  stepsBefore?: number;
}) {
  const [step, setStep] = useState<Step>('details');
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [certificates, setCertificates] = useState(initialCertificates);
  const [horses, setHorses] = useState(initialHorses);
  const [addingHorse, setAddingHorse] = useState(false);

  const total = stepsBefore + STEPS.length;
  const numberOf = (s: Step) => stepsBefore + STEPS.indexOf(s) + 1;

  // To the top of the next step: the details form is long on a phone, and its
  // buttons are at the bottom of it.
  const go = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  // A full navigation, not `router.push` — see `WelcomeFlow`. The navbar
  // decides on the exhibitor row and the horses just created, and a soft push
  // can serve the next screen from a cache built before either existed.
  const finish = () => {
    window.location.assign(destination);
  };

  const addHorse = (horse: MyHorse) => {
    setHorses((prev) => (prev.some((h) => h.id === horse.id) ? prev : [...prev, horse]));
    setAddingHorse(false);
  };

  // ProfileStep reads the checklist only to print what a show is still waiting
  // on, and there is no show here — so it is empty, and the step enforces its
  // required boxes from a constant of its own.
  const profile: ProfileStatus = { complete: false, missing: [], checklist: [], exhibitor };

  return (
    <div>
      <section hidden={step !== 'details'} className="space-y-5">
        <StepHeading
          step={numberOf('details')}
          total={total}
          title="About you"
          blurb="What a show office needs before it can take your entry — your contact details, your date of birth for the youth and amateur divisions, and an emergency contact."
        />
        <ProfileStep
          profile={profile}
          hasMembershipsStep
          onSaved={() => go('memberships')}
          onSkip={() => go('memberships')}
        />
        <p className={FOOTNOTE} style={{ color: 'var(--muted)' }}>
          A show asks for the starred boxes when you enter it, so you can leave them until then. Change
          any of this later under My Account.
        </p>
      </section>

      <section hidden={step !== 'memberships'} className="space-y-5">
        <StepHeading
          step={numberOf('memberships')}
          total={total}
          title="Your memberships"
          blurb="Your own member numbers with the associations you show under. Shows read them when you enter an association class, and the office checks your card at the desk."
        />
        <ExhibitorRegistrations
          exhibitorId={exhibitor.id}
          initialRegistrations={initialRegistrations}
          certificates={certificates}
          onCertificateUploaded={(cert) => setCertificates((prev) => [...prev, cert])}
          onCertificateDeleted={(id) => setCertificates((prev) => prev.filter((c) => c.id !== id))}
          onRegistrationsChanged={setRegistrations}
        />
        <StepNav onBack={() => go('details')}>
          {/* One way forward. Each membership is saved the moment it is added,
              so *Continue* and *Skip* would be two buttons doing one thing. */}
          <button
            type="button"
            onClick={() => go('horses')}
            className={PRIMARY_BUTTON}
            style={{ backgroundColor: 'var(--text-deep)' }}
          >
            {registrations.length > 0 ? 'Continue →' : 'Skip for now →'}
          </button>
        </StepNav>
        <p className={FOOTNOTE} style={{ color: 'var(--muted)' }}>
          Add more any time under My Account → Memberships, where your competition cards go too.
        </p>
      </section>

      <section hidden={step !== 'horses'} className="space-y-5">
        <StepHeading
          step={numberOf('horses')}
          total={total}
          title="Your horses"
          blurb="The horses you show — your own, or one you ride for somebody else. A horse needs its registered name and its owner; papers and health records can follow."
        />

        {addingHorse ? (
          <AddHorseWizard
            exhibitorId={exhibitor.id}
            profileHorseIds={new Set(horses.map((h) => h.id))}
            onCreated={addHorse}
            onLinked={addHorse}
            onCancel={() => setAddingHorse(false)}
            returnLabel="Back to your horses"
          />
        ) : (
          <>
            {horses.length > 0 && (
              <ul className="space-y-2">
                {horses.map((horse) => {
                  const coat = coatDescription(horse.color_name, horse.pattern_name);
                  return (
                    <li
                      key={horse.id}
                      className="rounded-lg border px-3 py-2"
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
                    >
                      <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                        {horse.name}
                      </span>
                      {horse.barn_name && (
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>
                          {' '}
                          &ldquo;{horse.barn_name}&rdquo;
                        </span>
                      )}
                      {coat && (
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                          {coat}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setAddingHorse(true)}
              className="w-full py-2 rounded-lg text-sm font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
            >
              {horses.length > 0 ? '+ Add another horse' : '+ Add a horse'}
            </button>

            <StepNav onBack={() => go('memberships')}>
              <button
                type="button"
                onClick={finish}
                className={PRIMARY_BUTTON}
                style={{ backgroundColor: 'var(--text-deep)' }}
              >
                {horses.length > 0 ? 'Finish setup →' : 'Skip for now and finish'}
              </button>
            </StepNav>
            <p className={FOOTNOTE} style={{ color: 'var(--muted)' }}>
              Add horses and their papers any time under My Account → My Horses.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** The bar along the bottom of a step, laid out like `ProfileStep`'s own. */
function StepNav({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--bg-subtle)' }}>
      {children}
      <button
        type="button"
        onClick={onBack}
        className="text-sm hover:underline ml-auto"
        style={{ color: 'var(--accent)' }}
      >
        ← Back
      </button>
    </div>
  );
}
