'use client';

import { useState, useCallback } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface AphaCert {
  status: 'idle' | 'checking' | 'found' | 'not-found' | 'error';
  first_name?: string;
  last_name?: string;
  expiration_date?: string;
  expired?: boolean;
}

export default function ShowManagerRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aphaCert, setAphaCert] = useState<AphaCert>({ status: 'idle' });

  const lookupApha = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) return;
    setAphaCert({ status: 'checking' });
    try {
      const res = await fetch(`/api/apha/verify-secretary?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) { setAphaCert({ status: 'error' }); return; }
      if (data.found) {
        setAphaCert({ status: 'found', first_name: data.first_name, last_name: data.last_name, expiration_date: data.expiration_date, expired: data.expired });
      } else {
        setAphaCert({ status: 'not-found' });
      }
    } catch {
      setAphaCert({ status: 'error' });
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    if (e.target.name === 'email') setAphaCert({ status: 'idle' });
  };

  const handleEmailBlur = () => {
    if (form.email) lookupApha(form.email);
  };

  const handleSubmit = async () => {
    if (!form.full_name || !form.email || !form.password) {
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
      body: JSON.stringify({ full_name: form.full_name, email: form.email, password: form.password }),
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

    router.push('/show-requests');
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {[
          { name: 'full_name', label: 'Full Name', type: 'text', placeholder: 'Jane Smith' },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'password', label: 'Password', type: 'password', placeholder: '•••••••• (min 8 chars)' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
        ].map(field => (
          <div key={field.name}>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
              {field.label}
            </label>
            <input
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              value={(form as Record<string, string>)[field.name]}
              onChange={handleChange}
              onBlur={field.name === 'email' ? handleEmailBlur : undefined}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
            />
          </div>
        ))}
      </div>

      {/* APHA certification lookup — recommended for managers */}
      <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: '#2c1810' }}>APHA Show Management Certification</p>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e8d5b7', color: '#5c3d1e' }}>
            Recommended
          </span>
        </div>
        <p className="text-xs" style={{ color: '#8b7355' }}>
          APHA recommends that Show Managers hold an active APHA Show Management Certification
          when hosting APHA-sanctioned events.{' '}
          <a href="https://apha.com/competition/show-management" target="_blank" rel="noopener noreferrer"
            className="underline" style={{ color: '#8b4513' }}>
            View certified list
          </a>
        </p>
        <AphaCertBadge cert={aphaCert} />
      </div>

      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#fdf6ee' }}>
        <p className="font-medium mb-1" style={{ color: '#2c1810' }}>What happens next?</p>
        <ol className="space-y-1 list-decimal list-inside" style={{ color: '#5a3e2b' }}>
          <li>Create your account and log in immediately.</li>
          <li>Submit a show hosting request with your association and venue details.</li>
          <li>An admin reviews your request — on approval, your show is created automatically.</li>
        </ol>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
      >
        {loading ? 'Creating account…' : 'Create Show Manager Account'}
      </button>
    </div>
  );
}

function AphaCertBadge({ cert }: { cert: AphaCert }) {
  if (cert.status === 'idle') {
    return <p className="text-xs" style={{ color: '#8b7355' }}>Enter your email above to check your certification status.</p>;
  }
  if (cert.status === 'checking') {
    return <p className="text-xs" style={{ color: '#8b7355' }}>Checking APHA certification…</p>;
  }
  if (cert.status === 'found') {
    const expLabel = cert.expiration_date
      ? `Expires ${new Date(cert.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';
    if (cert.expired) {
      return (
        <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
          <span className="font-semibold">⚠ Certification expired</span>
          {expLabel && <span className="ml-1">— {expLabel}</span>}
        </div>
      );
    }
    return (
      <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>
        <span className="font-semibold">✓ APHA Show Management Certification verified</span>
        {expLabel && <span className="ml-1">— {expLabel}</span>}
      </div>
    );
  }
  if (cert.status === 'not-found') {
    return (
      <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
        <span className="font-semibold">Not found in APHA certified list</span>
        <span className="block mt-0.5">
          This is recommended but not required. You can still register and host APHA events.
        </span>
      </div>
    );
  }
  return (
    <p className="text-xs" style={{ color: '#8b7355' }}>
      Could not reach the APHA certification list.{' '}
      <a href="https://apha.com/competition/show-management" target="_blank" rel="noopener noreferrer"
        className="underline" style={{ color: '#8b4513' }}>
        Verify manually
      </a>.
    </p>
  );
}
