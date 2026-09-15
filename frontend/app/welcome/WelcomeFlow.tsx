'use client';

import { useState } from 'react';
import type { AssociationOption } from '@/components/AssociationSelect';
import type { ProfileStatus } from '../shows/[id]/register/types';
import ProfileStep from '../shows/[id]/register/ProfileStep';
import CertificationPicker, { type CertEntry } from './CertificationPicker';

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
  destination,
  roleLabel,
}: {
  associations: AssociationOption[];
  initialCertifications: CertEntry[];
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
    // ProfileStep is the registration wizard's step one, rendered here against
    // the same `PATCH /api/exhibitors/{id}` — one writer for these boxes,
    // which is the rule that keeps /profile and registration from disagreeing.
    // The checklist is empty because it is computed per show and there is no
    // show here; ProfileStep reads it only to print what is outstanding, and
    // enforces its own required fields from a constant of its own.
    //
    // `hasMembershipsStep` suppresses its link out to /profile?tab=memberships.
    // With an empty checklist neither branch renders anything, but the claim is
    // the right one: sending somebody to another screen half-way through
    // onboarding is the trip this flow exists to avoid, and their memberships
    // are an exhibitor's own question rather than a show official's.
    const profile: ProfileStatus = {
      complete: false,
      missing: [],
      checklist: [],
      exhibitor,
    };
    return (
      <div className="space-y-5">
        <StepHeading
          step={2}
          total={2}
          title="Your exhibitor profile"
          blurb="What a show office needs before it can take your entry — your contact details, your date of birth for the youth and amateur divisions, and someone to ring if you come off in the arena."
        />
        <ProfileStep profile={profile} hasMembershipsStep onSaved={finish} />
        <button
          onClick={finish}
          className="w-full py-2 rounded-lg text-sm font-medium border"
          style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
        >
          Skip for now — finish this later
        </button>
        <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
          Your exhibitor profile is set up either way. You can fill these in from your profile, or the
          first time you enter a show.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StepHeading
        step={1}
        total={wantsExhibitor ? 2 : 1}
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

function StepHeading({
  step,
  total,
  title,
  blurb,
}: {
  step: number;
  total: number;
  title: string;
  blurb: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Step {step} of {total}
      </p>
      <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--foreground)' }}>
        {title}
      </h2>
      <p className="text-sm mt-1" style={{ color: 'var(--text-deep)' }}>
        {blurb}
      </p>
    </div>
  );
}
