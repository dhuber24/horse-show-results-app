'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProfileStatus } from './types';

/**
 * Step one: the exhibitor's own record, filled in before anything else.
 *
 * Somebody entering their first show used to reach a stall picker before the
 * office had their telephone number, their date of birth or anyone to ring if
 * they came off in the arena — and nobody goes back afterwards to fill that in.
 * So the personal details come first, and the two halves below stay shut until
 * they are done.
 *
 * **Edited in place rather than linked out to.** Bouncing somebody to
 * `/profile` mid-registration on a phone is how people lose their place and
 * never come back; the boxes are here and post to the same
 * `PATCH /api/exhibitors/{id}` the profile screen uses, so there is one writer.
 * The two things that genuinely have their own screens — horses and
 * memberships — are links, because adding a horse runs the document-extraction
 * wizard and rebuilding that here would be a second version of it to keep in
 * step.
 *
 * The checklist is the backend's, not this component's. `PUT /signup` refuses
 * on the identical list, so a form saying "all done" over an endpoint that
 * disagrees is not a state this screen can reach.
 */

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  hint,
  autoComplete,
  className = '',
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  hint?: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium mb-1" style={{ color: '#5d4a37' }}>
        {label}
      </label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full px-3 py-2 rounded border text-sm"
        style={{ borderColor: '#d4b896', backgroundColor: '#ffffff', color: '#2c1810' }}
      />
      {hint && <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>{hint}</p>}
    </div>
  );
}

export default function ProfileStep({
  profile,
  horseCount,
}: {
  profile: ProfileStatus;
  /** Only for the wording on the horses row — the tick itself is always the
   *  backend's, in `profile.checklist`. Omitted where the caller has no horse
   *  list to hand, in which case the row says whether there is one rather than
   *  how many. */
  horseCount?: number;
}) {
  const router = useRouter();
  const { exhibitor } = profile;
  const [form, setForm] = useState({
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setSaved(false);
  };

  const handleSave = async () => {
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
      // and unlocks the next section.
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  const horseItem = profile.checklist.find((i) => i.key === 'horses');
  const membershipItem = profile.checklist.find((i) => i.key === 'memberships');
  const hasHorses = horseCount != null ? horseCount > 0 : Boolean(horseItem?.complete);

  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {profile.checklist.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className="shrink-0 mt-0.5"
              style={{ color: item.complete ? '#15803d' : item.blocking ? '#b91c1c' : '#b45309' }}
            >
              {item.complete ? '✓' : item.blocking ? '•' : '○'}
            </span>
            <span>
              <span
                className="font-medium"
                style={{ color: item.complete ? '#5d4a37' : '#2c1810' }}
              >
                {item.label}
              </span>
              {!item.blocking && !item.complete && (
                <span className="text-xs ml-1.5" style={{ color: '#b45309' }}>(optional)</span>
              )}
              <span className="block text-xs" style={{ color: '#8b7355' }}>{item.hint}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="pt-3 border-t" style={{ borderColor: '#f0e4d0' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: '#2c1810' }}>Your details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Date of birth"
            name="date_of_birth"
            type="date"
            value={form.date_of_birth}
            onChange={handleChange}
            autoComplete="bday"
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            autoComplete="tel"
          />
          <Field
            label="Street address"
            name="address"
            value={form.address}
            onChange={handleChange}
            autoComplete="street-address"
            className="sm:col-span-2"
          />
          <Field
            label="City"
            name="city"
            value={form.city}
            onChange={handleChange}
            autoComplete="address-level2"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="State"
              name="state"
              value={form.state}
              onChange={handleChange}
              autoComplete="address-level1"
            />
            <Field
              label="ZIP"
              name="zip"
              value={form.zip}
              onChange={handleChange}
              autoComplete="postal-code"
            />
          </div>
          <Field
            label="Emergency contact name"
            name="emergency_contact_name"
            value={form.emergency_contact_name}
            onChange={handleChange}
          />
          <Field
            label="Emergency contact phone"
            name="emergency_contact_phone"
            type="tel"
            value={form.emergency_contact_phone}
            onChange={handleChange}
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

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: '#8b4513' }}
          >
            {saving ? 'Saving…' : 'Save my details'}
          </button>
          {saved && !saving && <span className="text-sm" style={{ color: '#15803d' }}>Saved.</span>}
          <Link
            href="/profile"
            className="text-sm hover:underline ml-auto"
            style={{ color: '#8b4513' }}
          >
            Full profile →
          </Link>
        </div>
      </div>

      {/* Horses and memberships have their own screens — a horse because adding
          one runs the document-extraction wizard, a membership because it is a
          row per association. Linked rather than rebuilt here. */}
      <div className="pt-3 border-t space-y-3" style={{ borderColor: '#f0e4d0' }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-sm font-semibold" style={{ color: '#2c1810' }}>Your horses</span>
            <span className="block text-xs" style={{ color: '#8b7355' }}>
              {!hasHorses
                ? 'You need at least one horse before you can enter classes.'
                : horseCount != null
                  ? `${horseCount} horse${horseCount === 1 ? '' : 's'} on your profile.`
                  : 'On your profile.'}
            </span>
          </div>
          <Link
            href="/profile/horses/new"
            className="text-sm font-medium hover:underline"
            style={{ color: horseItem?.complete ? '#8b4513' : '#b91c1c' }}
          >
            {hasHorses ? 'Add another horse →' : 'Add a horse →'}
          </Link>
        </div>

        {membershipItem && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
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
      </div>
    </div>
  );
}
