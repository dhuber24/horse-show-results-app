'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { safeNextPath } from '@/lib/safe-next';

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  // Sanitized on the server that passed it in; re-checked here so a bad value
  // can only ever mean "go home".
  const destination = safeNextPath(next) ?? '/';
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    const result = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      if (result.error.includes('pending admin approval')) {
        setError('Your account is pending admin approval. Please check back soon.');
      } else {
        setError('Invalid email or password.');
      }
    } else {
      router.push(destination);
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Email</label>
        <input name="email" type="email" placeholder="you@example.com" value={form.email}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Password</label>
        <input name="password" type="password" placeholder="••••••••" value={form.password}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }} />
        <div className="text-right mt-1">
          <Link href="/forgot-password" className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
            Forgot your password?
          </Link>
        </div>
      </div>
      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
      <button onClick={handleSubmit} disabled={loading}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </div>
  );
}
