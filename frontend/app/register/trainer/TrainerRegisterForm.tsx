'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { listingProblem } from '@/lib/trainer-registry';

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  private_phone: string;
  public_email: string;
  public_phone: string;
  business_name: string;
  city: string;
  state: string;
  zip_code: string;
  password: string;
  confirm_password: string;
};

const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-70';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

function TextField({
  name,
  label,
  type,
  placeholder,
  value,
  onChange,
  disabled,
}: {
  name: keyof FormState;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={`trainer-${name}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
        {label}
      </label>
      <input
        id={`trainer-${name}`}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClass}
        style={disabled ? { ...inputStyle, backgroundColor: 'var(--bg-subtle)' } : inputStyle}
      />
    </div>
  );
}

function GroupHeading({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>{note}</p>
    </div>
  );
}

export default function TrainerRegisterForm({ disciplines }: { disciplines: string[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    first_name: '',
    last_name: '',
    email: '',
    private_phone: '',
    public_email: '',
    public_phone: '',
    business_name: '',
    city: '',
    state: '',
    zip_code: '',
    password: '',
    confirm_password: '',
  });
  // The public boxes show the private values while this is ticked, and the
  // private values are what is sent -- so editing the private email after
  // ticking it can't leave a stale copy behind.
  const [sameAsPrivate, setSameAsPrivate] = useState(false);
  const [listInRegistry, setListInRegistry] = useState(false);
  const [chosenDisciplines, setChosenDisciplines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const toggleDiscipline = (name: string) =>
    setChosenDisciplines((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]));

  const publicEmail = sameAsPrivate ? form.email : form.public_email;
  const publicPhone = sameAsPrivate ? form.private_phone : form.public_phone;

  const handleSubmit = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email || !form.private_phone || !form.password) {
      setError('First name, last name, private email, private phone, and password are required.');
      return;
    }
    // The rule the backend holds too (trainer_registry.listing_problem).
    const problem = listInRegistry
      ? listingProblem({ city: form.city, state: form.state, zip_code: form.zip_code, disciplines: chosenDisciplines })
      : null;
    if (problem) {
      setError(problem);
      return;
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/register/trainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email,
        private_phone: form.private_phone,
        public_email: publicEmail.trim() || null,
        public_phone: publicPhone.trim() || null,
        list_in_registry: listInRegistry,
        business_name: listInRegistry ? form.business_name.trim() || null : null,
        city: listInRegistry ? form.city.trim() : null,
        state: listInRegistry ? form.state.trim() : null,
        zip_code: listInRegistry ? form.zip_code.trim() : null,
        disciplines: listInRegistry ? chosenDisciplines : [],
        password: form.password,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(errorMessage(data, 'Registration failed.'));
      setLoading(false);
      return;
    }

    const signInResult = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    if (signInResult?.error) {
      setError('Account created. Please log in to continue.');
      setLoading(false);
      return;
    }

    // Somebody who asked to be listed goes on to choose a plan.
    router.push(listInRegistry ? '/profile/registry' : '/profile');
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <TextField name="first_name" label="First Name" type="text" placeholder="Jane" value={form.first_name} onChange={handleChange} />
        <TextField name="last_name" label="Last Name" type="text" placeholder="Smith" value={form.last_name} onChange={handleChange} />
      </div>

      <div className="space-y-4">
        <GroupHeading title="Private Contact" note="Your login and how the show office reaches you. Never shown publicly." />
        <TextField name="email" label="Private Email" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange} />
        <TextField name="private_phone" label="Private Phone" type="tel" placeholder="(555) 123-4567" value={form.private_phone} onChange={handleChange} />
      </div>

      <div className="space-y-4">
        <GroupHeading title="Public Contact" note="Optional. Shown with your trainer record, and on your listing if you join the Trainer Registry." />
        <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={sameAsPrivate}
            onChange={(e) => setSameAsPrivate(e.target.checked)}
          />
          <span>My public email and phone are the same as my private ones</span>
        </label>
        <TextField
          name="public_email"
          label="Public Email"
          type="email"
          placeholder={sameAsPrivate ? 'Same as private email' : 'public@example.com (optional)'}
          value={publicEmail}
          onChange={handleChange}
          disabled={sameAsPrivate}
        />
        <TextField
          name="public_phone"
          label="Public Phone"
          type="tel"
          placeholder={sameAsPrivate ? 'Same as private phone' : '(555) 987-6543 (optional)'}
          value={publicPhone}
          onChange={handleChange}
          disabled={sameAsPrivate}
        />
      </div>

      <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
        <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={listInRegistry}
            onChange={(e) => setListInRegistry(e.target.checked)}
          />
          <span>
            <span className="font-medium">List me in the Trainer Registry</span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--text-deep)' }}>
              Advertise your services to exhibitors browsing the{' '}
              <Link href="/trainers" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--accent)' }}>
                Trainer Registry
              </Link>
              . List free on Basic, or go Pro and GaitDesk will prioritize your profile based on proximity to the
              exhibitor viewing the registry. You&apos;ll see the plans side by side once your account is set up.
            </span>
          </span>
        </label>
        {listInRegistry && (
          <>
            <TextField
              name="business_name"
              label="Business / Barn Name (optional)"
              type="text"
              placeholder="Smith Performance Horses"
              value={form.business_name}
              onChange={handleChange}
            />
            <div className="grid grid-cols-[1fr_5rem] gap-3">
              <TextField name="city" label="Town" type="text" placeholder="Ocala" value={form.city} onChange={handleChange} />
              <TextField name="state" label="State" type="text" placeholder="FL" value={form.state} onChange={handleChange} />
            </div>
            <div className="w-32">
              <TextField name="zip_code" label="Zip Code" type="text" placeholder="34470" value={form.zip_code} onChange={handleChange} />
            </div>
            <fieldset>
              <legend className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                What do you train?
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                {disciplines.map((name) => (
                  <label key={name} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
                    <input type="checkbox" checked={chosenDisciplines.includes(name)} onChange={() => toggleDiscipline(name)} />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Your zip code places you in near-me searches and is never shown. You&apos;ll choose Basic or Pro next.
            </p>
          </>
        )}
      </div>

      <div className="space-y-4">
        <TextField name="password" label="Password" type="password" placeholder="Min 8 characters" value={form.password} onChange={handleChange} />
        <TextField name="confirm_password" label="Confirm Password" type="password" placeholder="Re-enter password" value={form.confirm_password} onChange={handleChange} />
      </div>

      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--foreground)' }}>What this creates</p>
        <p style={{ color: 'var(--text-deep)' }}>
          Your login is created with the Trainer role and linked to the trainer registry used on horse profiles.
          Private contact fields are required for account/admin use. Public contact fields are optional and can be shown with your trainer record.
        </p>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        title={loading ? 'Creating your account…' : undefined}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
      >
        {loading ? 'Creating account...' : 'Create Trainer Account'}
      </button>
    </div>
  );
}
