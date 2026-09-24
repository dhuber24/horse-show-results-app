'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * Create the account, and nothing else.
 *
 * This screen used to carry the certification picker itself, plus an APHA
 * lookup that **blocked submission** unless APHA's certified list returned a
 * live hit for the email being registered. Three things were wrong with that.
 *
 * The picker could never work: it fetched `/api/associations` on mount, and
 * that route requires a session, which a person creating an account does not
 * have yet. So it 401'd, the list rendered empty, and every secretary who ever
 * used this screen saw "No certifications selected" with nothing to select.
 *
 * The APHA gate refused a registration over a fact this app cannot establish.
 * GaitDesk does not verify membership or certification with any association —
 * it records what people tell it, the same call `exhibitor_registrations`
 * makes about a membership card. A hard stop on an unverifiable claim turns
 * away real secretaries whose email on APHA's list differs from the one they
 * sign up with, and it is not a stop APHA asked this app to enforce.
 *
 * And naming one registry on the screen every new secretary sees told the AQHA,
 * ApHC, FQHR and unaffiliated shows this app also serves that they were in the
 * wrong place.
 *
 * Certifications are asked at `/welcome`, one step behind this, where the
 * association list can actually be fetched.
 */
export default function ShowSecretaryRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    organization_name: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email || !form.password) {
      setError('All fields are required.');
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

    const res = await fetch('/api/auth/register/show-secretary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email,
        password: form.password,
        organization_name: form.organization_name.trim() || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Registration failed.');
      setLoading(false);
      return;
    }

    const signInResult = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
    if (signInResult?.error) {
      setError('Account created. Please log in to continue.');
      setLoading(false);
      return;
    }

    router.push('/welcome');
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {[
          { name: 'first_name', label: 'First Name', type: 'text', placeholder: 'Jane' },
          { name: 'last_name', label: 'Last Name', type: 'text', placeholder: 'Smith' },
          // Optional (migration 143). Blank is an independent, who gets a company of
          // their own under their name; a name already on GaitDesk is a request to
          // join it, which a GaitDesk admin approves, because joining carries that
          // company's paid features.
          {
            name: 'organization_name',
            label: 'Company / Organization',
            type: 'text',
            placeholder: 'e.g. Minnesota Paint Horse Club',
            optional: true,
            hint: "Leave blank if you work for yourself — we'll set you up under your own name. If your organization is already on GaitDesk, we'll confirm you with them first.",
          },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'password', label: 'Password', type: 'password', placeholder: '•••••••• (min 8 chars)' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
        ].map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {field.label}
              {field.optional && <span className="font-normal" style={{ color: 'var(--muted)' }}> (optional)</span>}
            </label>
            <input
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              value={(form as Record<string, string>)[field.name]}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
            />
            {field.hint && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{field.hint}</p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--foreground)' }}>What happens next?</p>
        <ol className="space-y-1 list-decimal list-inside" style={{ color: 'var(--text-deep)' }}>
          <li>Create your account and log in immediately.</li>
          <li>Tell us which associations you are certified with — or skip it.</li>
          <li>A show manager assigns you to their show, and the desk is yours.</li>
        </ol>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
      >
        {loading ? 'Creating account…' : 'Create Show Secretary Account'}
      </button>
    </div>
  );
}
