'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isMinorOn, todayIso } from '@/lib/minor';
import type { ProfileStatus } from './types';

/**
 * Step one: the exhibitor themselves.
 *
 * Somebody entering their first show used to reach a stall picker before the
 * office had their telephone number, their date of birth or anyone to ring if
 * they came off in the arena — and nobody goes back afterwards to fill that in.
 * So the person comes first, their horses come second, and the grounds and the
 * classes follow.
 *
 * **Edited in place rather than linked out to.** Bouncing somebody to
 * `/profile` mid-registration on a phone is how people lose their place and
 * never come back, so the boxes are here.
 *
 * **Inside a show's registration it never writes the profile** (migration
 * 145). With `showId` the boxes are prefilled from the profile and saved to
 * `PUT /shows/{id}/register/details` — that show's copy — so a phone number
 * corrected for one weekend is not rewritten on every other. Without one, on
 * `/welcome`, this *is* the profile being filled in, and it saves through the
 * same `PATCH /api/exhibitors/{id}` the profile screen uses.
 *
 * **Required is marked in the field, and enforced on the way out.** The
 * asterisk rides in the placeholder rather than in a list above the form,
 * because a list of names is something you have to hold in your head while
 * looking at boxes that all look alike. Pressing *Save & continue* with one
 * empty outlines exactly those boxes and moves the focus to the first — the
 * button is never disabled, because a disabled button with nothing pointing at
 * the reason is the same dead end read a different way.
 *
 * **What is outstanding is one line, not a checklist.** It was a bulleted list
 * of every row with a hint under it, above a form carrying the same labels and
 * two of the same hints verbatim — a screenful of small print on a phone,
 * restating the boxes directly beneath it. The labels come from the backend
 * either way: `PUT /signup` refuses on the identical list, so a form saying
 * "all done" over an endpoint that disagrees is not a state this screen can
 * reach.
 */

/** What step one will not go on without. Mirrors the blocking rows
 *  `exhibitor_profile.py` marks `step: 'details'` — the backend is what
 *  enforces this; the copy here only decides which boxes get an asterisk and
 *  an outline. `full_name` is absent because it is set at sign-up and has no
 *  box on this form; the guardian pair is below, required only of a minor. */
const REQUIRED_FIELDS = [
  'date_of_birth',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'emergency_contact_name',
  'emergency_contact_phone',
] as const;

/** Required as well while the exhibitor is under 18 — the backend's
 *  `parent_guardian` row, which only exists for a minor. Both halves, like the
 *  emergency contact: a name the office cannot ring is nobody to call. */
const GUARDIAN_FIELDS = ['parent_guardian_name', 'parent_guardian_phone'] as const;

type FieldName = (typeof REQUIRED_FIELDS)[number] | (typeof GUARDIAN_FIELDS)[number];

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  hint,
  autoComplete,
  required = false,
  invalid = false,
  className = '',
}: {
  label: string;
  name: FieldName;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={`profile-${name}`}
        className="block text-xs font-medium mb-1"
        style={{ color: invalid ? 'var(--error)' : 'var(--text-deep)' }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--error)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={`profile-${name}`}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        required={required}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `profile-${name}-error` : undefined}
        // The asterisk in the box itself. A date input shows no placeholder,
        // so those carry it on the label alone — which is why the label has one
        // too rather than relying on this.
        placeholder={required ? `Required *` : undefined}
        className="w-full px-3 py-2 rounded border text-sm"
        style={{
          // Two pixels, not one: a one-pixel red border against a beige field
          // is not something anybody spots on a phone in a barn aisle.
          borderColor: invalid ? 'var(--error)' : 'var(--border)',
          borderWidth: invalid ? 2 : 1,
          backgroundColor: invalid ? 'var(--error-bg)' : 'var(--surface)',
          color: 'var(--foreground)',
        }}
      />
      {invalid && (
        <p id={`profile-${name}-error`} className="text-xs mt-0.5" style={{ color: 'var(--error)' }}>
          Required.
        </p>
      )}
      {hint && !invalid && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function ProfileStep({
  profile,
  showId,
  asOf,
  hasMembershipsStep = false,
  onSaved,
}: {
  profile: ProfileStatus;
  /** The show whose registration this is. Saves go to that show's copy and
   *  never to the profile. Absent on `/welcome`, where the profile is what is
   *  being filled in. */
  showId?: string;
  /** The day a minor is judged on, `YYYY-MM-DD` — the show's first day, as the
   *  backend judges it. Today when absent (`/welcome`, which has no show). */
  asOf?: string;
  /** True when the caller renders a memberships step of its own — the
   *  registration wizard does, between this step and the horses. The prompt
   *  below is then a second, worse copy of that step: a line of hint text
   *  and a link out to /profile, which is the trip the step exists to spare
   *  somebody. False is `/shows/[id]/signup`, the direct door onto sign-up,
   *  which has no wizard around it and would otherwise never mention
   *  memberships at all. */
  hasMembershipsStep?: boolean;
  /** Run after a save that leaves nothing required outstanding — the wizard
   *  moves on to the horses. Not called on a save that still has gaps, because
   *  advancing past a step the backend will refuse on is the thing the lock
   *  exists to prevent.
   *
   *  Optional because `/shows/[id]/signup` renders this from a server
   *  component, which cannot hand a callback across the boundary. There the
   *  `router.refresh()` above is what reveals the next form, which is the same
   *  outcome by a slower route. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { exhibitor } = profile;
  const [form, setForm] = useState<Record<FieldName, string>>({
    date_of_birth: exhibitor.date_of_birth ?? '',
    phone: exhibitor.phone ?? '',
    address: exhibitor.address ?? '',
    city: exhibitor.city ?? '',
    state: exhibitor.state ?? '',
    zip: exhibitor.zip ?? '',
    emergency_contact_name: exhibitor.emergency_contact_name ?? '',
    emergency_contact_phone: exhibitor.emergency_contact_phone ?? '',
    parent_guardian_name: exhibitor.parent_guardian_name ?? '',
    parent_guardian_phone: exhibitor.parent_guardian_phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Empty until somebody actually tries to move on. Outlining a form somebody
  // has not filled in yet is scolding them for not having typed fast enough.
  const [rawInvalid, setInvalid] = useState<Set<string>>(new Set());

  // Read off the box as it is typed, so the guardian fields turn required the
  // moment a date of birth makes somebody a minor — not after a save the
  // backend would refuse.
  const minor = isMinorOn(form.date_of_birth, asOf ?? todayIso());
  const required: readonly FieldName[] = minor
    ? [...REQUIRED_FIELDS, ...GUARDIAN_FIELDS]
    : REQUIRED_FIELDS;
  // Only what is still required. A guardian box outlined while the exhibitor
  // was a minor stops being red when the date of birth is corrected to an
  // adult's, rather than scolding them for a box nobody wants any more.
  const invalid = new Set([...rawInvalid].filter((f) => required.includes(f as FieldName)));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name as FieldName]: value }));
    setSaved(false);
    // Clears as they type, so the red goes away at the moment it stops being
    // true rather than on the next press of the button.
    setInvalid((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const handleSave = async () => {
    const missing = required.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      setInvalid(new Set(missing));
      setError(null);
      // The first empty box, focused and scrolled to. On a long form the
      // outline is below the fold as often as not.
      document.getElementById(`profile-${missing[0]}`)?.focus();
      document
        .getElementById(`profile-${missing[0]}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    setSaving(true);
    setError(null);
    // A show's registration saves to that show's copy; only /welcome, which
    // has no show, writes the profile.
    const url = showId
      ? `/api/shows/${showId}/register/details`
      : `/api/exhibitors/${exhibitor.id}`;
    try {
      const res = await fetch(url, {
        method: showId ? 'PUT' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_of_birth: form.date_of_birth || null,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          zip: form.zip.trim() || null,
          emergency_contact_name: form.emergency_contact_name.trim() || null,
          emergency_contact_phone: form.emergency_contact_phone.trim() || null,
          parent_guardian_name: form.parent_guardian_name.trim() || null,
          parent_guardian_phone: form.parent_guardian_phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.detail === 'string' ? data.detail : 'Could not save your details.');
        setSaving(false);
        return;
      }
      setSaved(true);
      setSaving(false);
      // The checklist is server-side, so a refresh is what re-ticks the rows
      // and unlocks the step below.
      router.refresh();
      onSaved?.();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  // Only this step's rows. The horses live one step on and complaining about
  // them here is complaining about a screen that has not been reached yet.
  const detailItems = profile.checklist.filter((i) => i.step === 'details');
  const membershipItem = hasMembershipsStep
    ? undefined
    : detailItems.find((i) => i.key === 'memberships');

  // One line, not a checklist. This used to be a bulleted list of every row
  // with its hint under it -- six items, thirteen lines -- sitting directly
  // above a form carrying the same labels, the same asterisks and, on two
  // rows, the same hint text word for word. On a phone that was a screenful of
  // small print restating the boxes underneath it. What is outstanding is
  // still said, because the boxes below are the only other thing saying it on
  // `/shows/[id]/signup`, which has no section header to carry a summary.
  const stillNeeded = detailItems.filter((i) => i.blocking && !i.complete);

  return (
    <div className="space-y-4">
      {stillNeeded.length > 0 && (
        <p className="text-sm" style={{ color: 'var(--error)' }}>
          Still needed: {stillNeeded.map((i) => i.label.toLowerCase()).join(', ')}.
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          Your details
        </h3>
        {/* One line, because it is the thing somebody would otherwise assume
            wrong: that fixing a number here fixes it everywhere. */}
        {showId && (
          <p className="text-xs -mt-1 mb-3" style={{ color: 'var(--muted)' }}>
            {profile.own_copy?.details
              ? 'Changed for this show — your profile is unchanged.'
              : 'From your profile. Changes here apply to this show only.'}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Date of birth"
            name="date_of_birth"
            type="date"
            value={form.date_of_birth}
            onChange={handleChange}
            autoComplete="bday"
            required
            invalid={invalid.has('date_of_birth')}
            hint="Sets your youth/amateur division."
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            autoComplete="tel"
            required
            invalid={invalid.has('phone')}
          />
          <Field
            label="Street address"
            name="address"
            value={form.address}
            onChange={handleChange}
            autoComplete="street-address"
            required
            invalid={invalid.has('address')}
            className="sm:col-span-2"
          />
          <Field
            label="City"
            name="city"
            value={form.city}
            onChange={handleChange}
            autoComplete="address-level2"
            required
            invalid={invalid.has('city')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="State"
              name="state"
              value={form.state}
              onChange={handleChange}
              autoComplete="address-level1"
              required
              invalid={invalid.has('state')}
            />
            <Field
              label="ZIP"
              name="zip"
              value={form.zip}
              onChange={handleChange}
              autoComplete="postal-code"
              required
              invalid={invalid.has('zip')}
            />
          </div>
          <Field
            label="Emergency contact name"
            name="emergency_contact_name"
            value={form.emergency_contact_name}
            onChange={handleChange}
            required
            invalid={invalid.has('emergency_contact_name')}
          />
          <Field
            label="Emergency contact phone"
            name="emergency_contact_phone"
            type="tel"
            value={form.emergency_contact_phone}
            onChange={handleChange}
            required
            invalid={invalid.has('emergency_contact_phone')}
          />
          {/* Required of a minor and only of a minor — plenty of exhibitors are
              adults, and asking them would be a box they learn to skip. The
              backend's `parent_guardian` row is the enforcement; this only
              decides the asterisks and the outline. */}
          <Field
            label="Parent / guardian name"
            name="parent_guardian_name"
            value={form.parent_guardian_name}
            onChange={handleChange}
            required={minor}
            invalid={invalid.has('parent_guardian_name')}
            hint={minor ? 'Required — you’re under 18.' : 'If under 18.'}
          />
          <Field
            label="Parent / guardian phone"
            name="parent_guardian_phone"
            type="tel"
            value={form.parent_guardian_phone}
            onChange={handleChange}
            required={minor}
            invalid={invalid.has('parent_guardian_phone')}
          />
        </div>

        {error && (
          <div
            className="mt-3 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
          >
            {error}
          </div>
        )}

        {invalid.size > 0 && (
          <div
            className="mt-3 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
          >
            {invalid.size === 1
              ? 'One box above is still empty — outlined in red.'
              : `${invalid.size} boxes above are still empty — outlined in red.`}
          </div>
        )}
      </div>

      {/* The exhibitor's own card. A *horse's* registration with the same
          association is a different fact and is asked about on the next step. */}
      {membershipItem && (
        <div
          className="pt-3 border-t flex flex-wrap items-baseline justify-between gap-2"
          style={{ borderColor: 'var(--bg-subtle)' }}
        >
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              Association memberships
            </span>
            <span className="block text-xs" style={{ color: 'var(--muted)' }}>
              {membershipItem.hint}
              {!membershipItem.complete && <> Optional — cards are checked at the desk.</>}
            </span>
          </div>
          <Link
            href="/profile?tab=memberships"
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Add my numbers →
          </Link>
        </div>
      )}

      <div
        className="pt-3 border-t flex flex-wrap items-center gap-3"
        style={{ borderColor: 'var(--bg-subtle)' }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--text-deep)' }}
        >
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
        {saved && !saving && (
          <span className="text-sm" style={{ color: 'var(--success)' }}>
            Saved.
          </span>
        )}
        <Link href="/profile" className="text-sm hover:underline ml-auto" style={{ color: 'var(--accent)' }}>
          Full profile →
        </Link>
      </div>
    </div>
  );
}
