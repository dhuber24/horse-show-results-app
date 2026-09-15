'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * Create the account, and nothing else.
 *
 * This screen used to carry an APHA Show Management Certification panel that
 * looked the signer-up's email up against APHA's certified list on blur. Two
 * things were wrong with it. GaitDesk runs AQHA, ApHC, FQHR and unaffiliated
 * shows as readily as APHA ones, so naming one registry on the only screen
 * every new manager sees told the other four they were in the wrong place. And
 * a lookup against somebody else's list is a verification this app has no
 * standing to make — see the note on `PUT /users/me/certifications`.
 *
 * What association somebody is carded with is now asked at `/welcome`, one
 * step behind this, where the full association list can actually be fetched.
 */
export default function ShowManagerRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', confirm_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
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

    const res = await fetch('/api/auth/register/show-manager', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email,
        password: form.password,
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
          { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'password', label: 'Password', type: 'password', placeholder: '•••••••• (min 8 chars)' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
        ].map(field => (
          <div key={field.name}>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              {field.label}
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
          </div>
        ))}
      </div>

      {/* The old copy here said an admin reviews a hosting request and creates
          the show on approval. There has been no per-show approval gate for a
          long time — a manager creates the show themselves at
          /admin/shows/new, and POST /shows/ links them to it automatically. */}
      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--foreground)' }}>What happens next?</p>
        <ol className="space-y-1 list-decimal list-inside" style={{ color: 'var(--text-deep)' }}>
          <li>Create your account and log in immediately.</li>
          <li>Tell us which associations you are certified with — or skip it.</li>
          <li>Build your first show, whatever body it runs under.</li>
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
        {loading ? 'Creating account…' : 'Create Show Manager Account'}
      </button>
    </div>
  );
}
