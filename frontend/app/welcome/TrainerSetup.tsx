'use client';

import { useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api-error';
import { listingProblem, type RegistryOptions } from '@/lib/trainer-registry';
import PlanMatrix from '../trainers/_components/PlanMatrix';
import ProProfileEditor, { type MyPicture, type ProProfileListing } from '../profile/registry/ProProfileEditor';
import { PlanActions, type MyListing } from '../profile/registry/RegistryManager';
import StepHeading from './StepHeading';

/** `TrainerProfileOut` — the parts this flow reads. */
export interface TrainerSetupListing extends MyListing, ProProfileListing {
  business_name: string | null;
}

type Step = 'listing' | 'profile' | 'plan';
const STEPS: Step[] = ['listing', 'profile', 'plan'];

const PRIMARY_BUTTON = 'px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50';
const FOOTNOTE = 'text-xs';
const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

/**
 * Setting up a trainer's Trainer Registry listing: where they work and what
 * they train and whether the listing is public, then their Pro profile, then
 * which plan it is on.
 *
 * The trainer's account form asks for a name, contact details and a password,
 * and this is where they land next. Being listed used to be a box on that
 * form, with the listing's boxes folded under it; here it is a choice made
 * after the account exists. **The profile comes before the plan**, so a
 * trainer has built what Pro would show before deciding whether to pay for it.
 *
 * **Every step writes through the endpoints My Account and the registry pages
 * use** — `PATCH /trainers/me` for the listing, which refuses a public listing
 * without a town, state, zip and discipline and emails the admins the moment
 * one goes on; `ProProfileEditor` for the profile, as on
 * `/profile/registry/pro-profile`; `PlanActions` for the plan — so this flow
 * never disagrees with them. **Every step can be skipped**, and nothing
 * records that one was: Basic is free and the listing stays off until
 * somebody turns it on.
 */
export default function TrainerSetup({
  listing,
  initialPictures,
  options,
  destination,
}: {
  listing: TrainerSetupListing;
  initialPictures: MyPicture[];
  options: RegistryOptions;
  /** Where finishing goes — `?next=`, or the trainer's registry page. */
  destination: string;
}) {
  const [step, setStep] = useState<Step>('listing');
  const [form, setForm] = useState({
    business_name: listing.business_name ?? '',
    city: listing.city ?? '',
    state: listing.state ?? '',
    zip_code: listing.zip_code ?? '',
  });
  const [disciplines, setDisciplines] = useState<string[]>(listing.disciplines ?? []);
  const [isPublic, setIsPublic] = useState(listing.is_public);
  // What the server holds, which is what the plan step should describe —
  // not a choice made on step 1 and then skipped.
  const [savedPublic, setSavedPublic] = useState(listing.is_public);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberOf = (s: Step) => STEPS.indexOf(s) + 1;

  const go = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  // A full navigation, not `router.push` — see `WelcomeFlow`.
  const finish = () => {
    window.location.assign(destination);
  };

  const update = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const toggleDiscipline = (name: string) =>
    setDisciplines((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]));

  // The rule the backend holds too (trainer_registry.listing_problem).
  const problem = isPublic ? listingProblem({ ...form, disciplines }) : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch('/api/trainers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_name: form.business_name.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip_code: form.zip_code.trim() || null,
        disciplines,
        is_public: isPublic,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(errorMessage(body, 'Could not save your listing.'));
      return;
    }
    setSavedPublic(isPublic);
    go('profile');
  };

  return (
    <div>
      <section hidden={step !== 'listing'} className="space-y-5">
        <StepHeading
          step={numberOf('listing')}
          total={STEPS.length}
          title="Your listing"
        />

        <div className="space-y-4">
          <div>
            <label htmlFor="trainer-business_name" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              Business / Barn Name (optional)
            </label>
            <input id="trainer-business_name" name="business_name" value={form.business_name} onChange={update} placeholder="Smith Performance Horses" maxLength={200} className={inputClass} style={inputStyle} />
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label htmlFor="trainer-city" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Town</label>
              <input id="trainer-city" name="city" value={form.city} onChange={update} placeholder="Ocala" maxLength={100} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="trainer-state" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>State</label>
              <input id="trainer-state" name="state" value={form.state} onChange={update} placeholder="FL" maxLength={50} className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div className="w-32">
            <label htmlFor="trainer-zip_code" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Zip Code</label>
            <input id="trainer-zip_code" name="zip_code" value={form.zip_code} onChange={update} placeholder="34470" maxLength={10} inputMode="numeric" className={inputClass} style={inputStyle} />
          </div>
          <fieldset>
            <legend className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>What do you train?</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
              {options.disciplines.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
                  <input type="checkbox" checked={disciplines.includes(name)} onChange={() => toggleDiscipline(name)} />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
          <legend className="sr-only">Who sees your listing</legend>
          <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
            <input type="radio" name="is_public" className="mt-0.5" checked={isPublic} onChange={() => setIsPublic(true)} />
            <span>
              <span className="font-medium">Make my listing public</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--text-deep)' }}>
                You appear on the{' '}
                <Link href="/trainers" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--accent)' }}>
                  Trainer Registry
                </Link>{' '}
                for exhibitors to find, with a page of your own to share.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
            <input type="radio" name="is_public" className="mt-0.5" checked={!isPublic} onChange={() => setIsPublic(false)} />
            <span>
              <span className="font-medium">Keep it private for now</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--text-deep)' }}>
                Show staff can still link horses to you. Turn the listing on any time under My Account.
              </span>
            </span>
          </label>
        </fieldset>

        {problem && <p className="text-sm" style={{ color: 'var(--warning-strong)' }}>{problem}</p>}
        {error && (
          <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
            {error}
          </p>
        )}

        <div className="pt-3 border-t flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--bg-subtle)' }}>
          <button
            type="button"
            onClick={save}
            disabled={saving || problem !== null}
            title={problem ?? (saving ? 'Saving…' : undefined)}
            className={PRIMARY_BUTTON}
            style={{ backgroundColor: 'var(--text-deep)' }}
          >
            {saving ? 'Saving…' : 'Save and continue →'}
          </button>
          <button type="button" onClick={() => go('profile')} className="text-sm hover:underline ml-auto" style={{ color: 'var(--accent)' }}>
            Skip for now
          </button>
        </div>
      </section>

      <section hidden={step !== 'profile'} className="space-y-5">
        <StepHeading
          step={numberOf('profile')}
          total={STEPS.length}
          title="Your Pro profile"
          blurb="What a Pro listing shows beyond the basics. Fill in as much as you like — you'll choose a plan next."
        />
        <ProProfileEditor
          listing={listing}
          initialPictures={initialPictures}
          options={options}
          saveLabel="Save and continue →"
          onSaved={() => go('plan')}
          secondaryAction={
            <>
              <button type="button" onClick={() => go('plan')} className="text-sm hover:underline ml-auto" style={{ color: 'var(--accent)' }}>
                Skip for now
              </button>
              <button type="button" onClick={() => go('listing')} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
                ← Back
              </button>
            </>
          }
        />
      </section>

      <section hidden={step !== 'plan'} className="space-y-5">
        <StepHeading
          step={numberOf('plan')}
          total={STEPS.length}
          title="Choose a plan"
          blurb="Basic lists you free. Pro puts you above Basic, nearest-first to the exhibitor searching, with a full profile and a Contact Trainer button."
        />
        <PlanMatrix
          limits={options}
          current={listing.is_pro ? 'pro' : 'basic'}
          proAction={<PlanActions listing={{ ...listing, is_public: savedPublic }} />}
        />

        <div className="pt-3 border-t flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--bg-subtle)' }}>
          <button type="button" onClick={finish} className={PRIMARY_BUTTON} style={{ backgroundColor: 'var(--text-deep)' }}>
            {listing.is_pro || listing.pro_request_plan ? 'Finish setup →' : 'Stay on Basic and finish →'}
          </button>
          <button type="button" onClick={() => go('profile')} className="text-sm hover:underline ml-auto" style={{ color: 'var(--accent)' }}>
            ← Back
          </button>
        </div>
        <p className={FOOTNOTE} style={{ color: 'var(--muted)' }}>
          Change your plan any time on My Trainer Registry listing, and your Pro profile on My Pro profile.
        </p>
      </section>
    </div>
  );
}
