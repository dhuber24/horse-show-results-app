'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
 * never come back; the boxes are here and post to the same
 * `PATCH /api/exhibitors/{id}` the profile screen uses, so there is one writer.
 *
 * **Required is marked in the field, and enforced on the way out.** The
 * asterisk rides in the placeholder rather than in a list above the form,
 * because a list of names is something you have to hold in your head while
 * looking at boxes that all look alike. Pressing *Save & continue* with one
 * empty outlines exactly those boxes and moves the focus to the first — the
 * button is never disabled, because a disabled button with nothing pointing at
 * the reason is the same dead end read a different way.
 *
 * The checklist above the form is the backend's, not this component's.
 * `PUT /signup` refuses on the identical list, so a form saying "all done"
 * over an endpoint that disagrees is not a state this screen can reach.
 */

/** What step one will not go on without. Mirrors the blocking rows
 *  `exhibitor_profile.py` marks `step: 'details'` — the backend is what
 *  enforces this; the copy here only decides which boxes get an asterisk and
 *  an outline. `full_name` is absent because it is set at sign-up and has no
 *  box on this form. */
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

type FieldName =
  | (typeof REQUIRED_FIELDS)[number]
  | 'parent_guardian_name'
  | 'parent_guardian_phone';

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
        style={{ color: invalid ? '#b91c1c' : '#5d4a37' }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: '#b91c1c' }}>
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
          borderColor: invalid ? '#b91c1c' : '#d4b896',
          borderWidth: invalid ? 2 : 1,
          backgroundColor: invalid ? '#fef2f2' : '#ffffff',
          color: '#2c1810',
        }}
      />
      {invalid && (
        <p id={`profile-${name}-error`} className="text-xs mt-0.5" style={{ color: '#b91c1c' }}>
          Required before you can go on.
        </p>
      )}
      {hint && !invalid && (
        <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function ProfileStep({
  profile,
  onSaved,
}: {
  profile: ProfileStatus;
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
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

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
    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
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
    try {
      const res = await fetch(`/api/exhibitors/${exhibitor.id}`, {
        method: 'PATCH',
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
  const membershipItem = detailItems.find((i) => i.key === 'memberships');

  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {detailItems.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className="shrink-0 mt-0.5"
              style={{ color: item.complete ? '#15803d' : item.blocking ? '#b91c1c' : '#b45309' }}
            >
              {item.complete ? '✓' : item.blocking ? '•' : '○'}
            </span>
            <span>
              <span className="font-medium" style={{ color: item.complete ? '#5d4a37' : '#2c1810' }}>
                {item.label}
              </span>
              {!item.blocking && !item.complete && (
                <span className="text-xs ml-1.5" style={{ color: '#b45309' }}>
                  (optional)
                </span>
              )}
              <span className="block text-xs" style={{ color: '#8b7355' }}>
                {item.hint}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="pt-3 border-t" style={{ borderColor: '#f0e4d0' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>
          Your details
        </h3>
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
            hint="Youth and amateur divisions are decided by age."
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
          {/* Not on the blocking list — plenty of exhibitors are adults. Asked
              for here because a youth entry without one is chased at the desk,
              and this is the screen where somebody is actually filling this in. */}
          <Field
            label="Parent / guardian name"
            name="parent_guardian_name"
            value={form.parent_guardian_name}
            onChange={handleChange}
            hint="If the exhibitor is under 18."
          />
          <Field
            label="Parent / guardian phone"
            name="parent_guardian_phone"
            type="tel"
            value={form.parent_guardian_phone}
            onChange={handleChange}
          />
        </div>

        {error && (
          <div
            className="mt-3 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
          >
            {error}
          </div>
        )}

        {invalid.size > 0 && (
          <div
            className="mt-3 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
          >
            {invalid.size === 1
              ? 'One box above still needs filling in — it’s outlined in red.'
              : `${invalid.size} boxes above still need filling in — they’re outlined in red.`}
          </div>
        )}
      </div>

      {/* The exhibitor's own card. A *horse's* registration with the same
          association is a different fact and is asked about on the next step. */}
      {membershipItem && (
        <div
          className="pt-3 border-t flex flex-wrap items-baseline justify-between gap-2"
          style={{ borderColor: '#f0e4d0' }}
        >
          <div>
            <span className="text-sm font-semibold" style={{ color: '#2c1810' }}>
              Association memberships
            </span>
            <span className="block text-xs" style={{ color: '#8b7355' }}>
              {membershipItem.hint}
              {!membershipItem.complete && (
                <> You can still enter without one — the show office checks cards at the desk.</>
              )}
            </span>
          </div>
          <Link
            href="/profile?tab=memberships"
            className="text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Add my numbers →
          </Link>
        </div>
      )}

      <div
        className="pt-3 border-t flex flex-wrap items-center gap-3"
        style={{ borderColor: '#f0e4d0' }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#5c3d1e' }}
        >
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
        {saved && !saving && (
          <span className="text-sm" style={{ color: '#15803d' }}>
            Saved.
          </span>
        )}
        <Link href="/profile" className="text-sm hover:underline ml-auto" style={{ color: '#8b4513' }}>
          Full profile →
        </Link>
      </div>
    </div>
  );
}
