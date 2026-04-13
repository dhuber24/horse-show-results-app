'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
    const res = await fetch('/api/auth/register', {
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
    // Auto sign in after registration
    await signIn('credentials', { email: form.email, password: form.password, redirect: false });
    router.push('/');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <input name="full_name" placeholder="Full name *" value={form.full_name}
        onChange={handleChange} className="w-full border rounded px-3 py-2" />
      <input name="email" type="email" placeholder="Email *" value={form.email}
        onChange={handleChange} className="w-full border rounded px-3 py-2" />
      <input name="password" type="password" placeholder="Password * (min 8 chars)" value={form.password}
        onChange={handleChange} className="w-full border rounded px-3 py-2" />
      <input name="confirm_password" type="password" placeholder="Confirm password *"
        value={form.confirm_password} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={loading}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/login" className="text-blue-500 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
