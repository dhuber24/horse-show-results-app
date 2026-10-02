'use client';

import { useState } from 'react';
import { COLORS, type ExhibitorContact } from './types';

/** The fields `PATCH /shows/{id}/exhibitors/{id}/contact` takes. */
export type ContactValues = {
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  guardian_name: string;
  guardian_phone: string;
};

/** What the form opens with. The email box is the office's own address: for an
 *  office record that is the address shown, and for somebody with an account it
 *  is only the *second* address the office wrote down — the one they sign in
 *  with is not the office's to change. */
function initialValues(contact: ExhibitorContact | undefined): ContactValues {
  const hasAccount = contact?.email_source === 'account';
  return {
    email: (hasAccount ? contact?.office_email : contact?.email) ?? '',
    phone: contact?.phone ?? '',
    address: contact?.address ?? '',
    city: contact?.city ?? '',
    state: contact?.state ?? '',
    zip: contact?.zip ?? '',
    guardian_name: contact?.guardian_name ?? '',
    guardian_phone: contact?.guardian_phone ?? '',
  };
}

const inputClass = 'w-full border rounded px-2 py-1.5 text-sm';
const inputStyle = {
  borderColor: COLORS.border,
  backgroundColor: 'var(--surface)',
  color: COLORS.text,
} as const;

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs mb-0.5" style={{ color: COLORS.muted }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * The office typing in how to reach somebody, over the counter.
 *
 * Nothing here is required — an exhibitor with no telephone is somebody the
 * office reaches another way, not paperwork anybody owes — so every box may be
 * left empty and Save is never disabled for want of one. Only the boxes that
 * changed are sent: an untouched blank says nothing, and sending it would clear
 * an office address that happened to match the account's.
 */
export default function ContactForm({
  contact,
  busy,
  onSave,
  onCancel,
}: {
  contact: ExhibitorContact | undefined;
  busy: boolean;
  onSave: (changes: Partial<ContactValues>) => void;
  onCancel: () => void;
}) {
  const [start] = useState(() => initialValues(contact));
  const [values, setValues] = useState(start);
  const accountEmail = contact?.email_source === 'account' ? contact.email : null;

  const set = (key: keyof ContactValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const changes = (Object.keys(values) as (keyof ContactValues)[]).reduce<Partial<ContactValues>>(
    (out, key) => (values[key].trim() !== start[key].trim() ? { ...out, [key]: values[key].trim() } : out),
    {},
  );
  const nothingChanged = Object.keys(changes).length === 0;

  return (
    // A form, so Enter in any box saves — the person is standing there reading
    // the details out.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nothingChanged) onSave(changes);
      }}
      className="rounded border p-3 space-y-3"
      style={{ borderColor: COLORS.borderSoft, backgroundColor: 'var(--surface)' }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={accountEmail ? 'Another email (optional)' : 'Email (optional)'}>
          <input
            type="email"
            value={values.email}
            onChange={set('email')}
            autoComplete="off"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Phone (optional)">
          <input
            value={values.phone}
            onChange={set('phone')}
            inputMode="tel"
            autoComplete="off"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>
      {accountEmail && (
        <p className="text-xs -mt-1" style={{ color: COLORS.muted }}>
          They sign in with {accountEmail}, which only they can change.
        </p>
      )}

      <Field label="Street address (optional)">
        <input
          value={values.address}
          onChange={set('address')}
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
      </Field>
      <div className="grid gap-2 grid-cols-[minmax(0,1fr)_5rem_6rem]">
        <Field label="City">
          <input value={values.city} onChange={set('city')} autoComplete="off" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="State">
          <input value={values.state} onChange={set('state')} autoComplete="off" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="ZIP">
          <input value={values.zip} onChange={set('zip')} autoComplete="off" className={inputClass} style={inputStyle} />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Parent or guardian (youth, optional)">
          <input
            value={values.guardian_name}
            onChange={set('guardian_name')}
            autoComplete="off"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Guardian's phone">
          <input
            value={values.guardian_phone}
            onChange={set('guardian_phone')}
            inputMode="tel"
            autoComplete="off"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || nothingChanged}
          title={nothingChanged ? 'Nothing has been changed yet' : undefined}
          className="text-xs font-medium px-2.5 py-1 rounded disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {busy ? 'Saving…' : 'Save contact details'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs hover:underline"
          style={{ color: COLORS.muted }}
        >
          Cancel
        </button>
        <span className="text-xs" style={{ color: COLORS.muted }}>
          Their own profile is not changed.
        </span>
      </div>
    </form>
  );
}
