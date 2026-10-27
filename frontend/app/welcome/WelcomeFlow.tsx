'use client';

import { useState, type ComponentProps } from 'react';
import type { AssociationOption } from '@/components/AssociationSelect';
import type { ProfileStatus } from '../shows/[id]/register/types';
import CertificationPicker, { type CertEntry } from './CertificationPicker';
import ExhibitorSetup from './ExhibitorSetup';
import StepHeading from './StepHeading';

type SetupProps = ComponentProps<typeof ExhibitorSetup>;

/**
 * The questions asked once, after the account exists.
 *
 * Show staff signup used to ask them on the account form itself, which put two
 * unrelated jobs on one screen and got both wrong. The association list behind
 * the picker comes from `/api/associations`, which needs a session — so on a
 * registration screen it answered 401 and the list was empty for every person
 * it was ever shown to. And the only association the form actually named was
 * APHA, by way of a certification lookup that on the secretary screen refused
 * to submit without a hit, which made APHA the one body a show could be run
 * under in an app built for several.
 *
 * So the account form is an account form, and these are a step behind it.
 *
 * **Everything on this screen is skippable.** A certification is a claim about
 * a body this app has no standing with, and the exhibitor question is about
 * what somebody might do next season. Neither is a reason to stand between a
 * new user and the show they came here to build — "Skip for now" is a real
 * answer, and the profile carries the same questions afterwards.
 */
export default function WelcomeFlow({
  associations,
  initialCertifications,
  initialExhibitor,
  initialRegistrations,
  initialCertificates,
  initialHorses,
  destination,
  roleLabel,
}: {
  associations: AssociationOption[];
  initialCertifications: CertEntry[];
  /** What is already on their exhibitor profile, for the steps behind *I also
   *  compete*. Empty when they have no profile yet. */
  initialRegistrations: SetupProps['initialRegistrations'];
  initialCertificates: SetupProps['initialCertificates'];
  initialHorses: SetupProps['initialHorses'];
  /** Their exhibitor row if they already have one — a returning user, or a
   *  role that is issued one at signup. Present means the checkbox starts
   *  ticked and locked: this step adds the profile and never takes it away,
   *  because unticking a box is not how somebody should be able to walk away
   *  from entries, horses and a show bill. */
  initialExhibitor: ProfileStatus['exhibitor'] | null;
  /** Where "done" goes — the first thing this role came to do. */
  destination: string;
  roleLabel: string;
}) {
  const [certs, setCerts] = useState<Record<string, CertEntry>>(() =>
    Object.fromEntries(initialCertifications.map((c) => [c.association_id, c])),
  );
  const [wantsExhibitor, setWantsExhibitor] = useState(initialExhibitor !== null);
  const [exhibitor, setExhibitor] = useState(initialExhibitor);
  const [step, setStep] = useState<'certifications' | 'exhibitor'>('certifications');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyHadProfile = initialExhibitor !== null;

  // A full navigation, not `router.push`. Two reasons, and the first is a bug
  // this had: `ProfileStep` calls `router.refresh()` immediately before it
  // calls `onSaved`, and a refresh landing on top of a push cancels it — the
  // profile saved, the screen said "Saved.", and the person stayed on step two
  // with nowhere to go. The second is that finishing here changes server state
  // the *next* screen renders from: the navbar reads the exhibitor row to
  // decide whether to show My Shows, and a soft push can serve it from the
  // client cache that was built before the row existed.
  const finish = () => {
    window.location.assign(destination);
  };

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/users/me/certifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certifications: Object.values(certs).map((c) => ({
            association_id: c.association_id,
            secretary_id_number: c.secretary_id_number.trim() || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Could not save your certifications.');
        setSaving(false);
        return;
      }

      if (!wantsExhibitor) {
        finish();
        return;
      }

      // The row is the permission — the backend decides exhibitor
      // self-registration on its presence, not on `users.role`. Returns the
      // existing row when there is one, so a second press is harmless.
      let record = exhibitor;
      if (!record) {
        const exRes = await fetch('/api/exhibitors/me', { method: 'POST' });
        if (!exRes.ok) {
          setError('Your certifications were saved, but we could not set up your exhibitor profile.');
          setSaving(false);
          return;
        }
        record = await exRes.json();
        setExhibitor(record);
      }
      setSaving(false);
      setStep('exhibitor');
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  if (step === 'exhibitor' && exhibitor) {
    // The same three steps an exhibitor is given at sign-up — details,
    // memberships, horses — numbered on from this one. An official who
    // competes is setting up the same profile, and handing them the details
    // alone left their horses for the first show they tried to enter.
    return (
      <ExhibitorSetup
        exhibitor={exhibitor}
        initialRegistrations={initialRegistrations}
        initialCertificates={initialCertificates}
        initialHorses={initialHorses}
        destination={destination}
        stepsBefore={1}
      />
    );
  }

  return (
    <div className="space-y-5">
      <StepHeading
        step={1}
        total={wantsExhibitor ? 4 : 1}
        title="Your certifications"
        blurb={`Which associations are you certified with as a ${roleLabel}? Tick any that apply — or none, if you run unaffiliated shows.`}
      />

      <CertificationPicker
        associations={associations}
        value={certs}
        onChange={setCerts}
        disabled={saving}
      />

      <p
        className="text-xs rounded-lg border px-3 py-2"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
      >
        GaitDesk records what you tell it and does not verify membership or certification with any
        association. Keeping your standing current is between you and them.
      </p>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={wantsExhibitor}
            onChange={(e) => setWantsExhibitor(e.target.checked)}
            disabled={saving || alreadyHadProfile}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            <span className="font-medium" style={{ color: 'var(--foreground)' }}>
              I also compete
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {alreadyHadProfile
                ? 'You already have an exhibitor profile on this account.'
                : 'Set me up as an exhibitor too, so I can enter shows I am not running. One account, both jobs.'}
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p
          className="text-sm px-3 py-2 rounded"
          style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        <button
          onClick={handleContinue}
          disabled={saving}
          className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
        >
          {saving ? 'Saving…' : wantsExhibitor ? 'Continue' : 'Finish setup'}
        </button>
        <button
          onClick={finish}
          disabled={saving}
          className="w-full py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
