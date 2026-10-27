'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  private_phone: string;
  public_email: string;
  public_phone: string;
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

export default function TrainerRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    first_name: '',
    last_name: '',
    email: '',
    private_phone: '',
    public_email: '',
    public_phone: '',
    password: '',
    confirm_password: '',
  });
  // The public boxes show the private values while this is ticked, and the
  // private values are what is sent -- so editing the private email after
  // ticking it can't leave a stale copy behind.
  const [sameAsPrivate, setSameAsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const publicEmail = sameAsPrivate ? form.email : form.public_email;
  const publicPhone = sameAsPrivate ? form.private_phone : form.public_phone;

  const handleSubmit = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email || !form.private_phone || !form.password) {
      setError('First name, last name, private email, private phone, and password are required.');
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

    // The listing, whether it is public, and the plan are asked next.
    router.push('/welcome');
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

      <div className="space-y-4">
        <TextField name="password" label="Password" type="password" placeholder="Min 8 characters" value={form.password} onChange={handleChange} />
        <TextField name="confirm_password" label="Confirm Password" type="password" placeholder="Re-enter password" value={form.confirm_password} onChange={handleChange} />
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
