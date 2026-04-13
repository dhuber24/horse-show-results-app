'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginForm() {
  const router = useRouter();
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
      setError('Invalid email or password.');
    } else {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <input name="email" type="email" placeholder="Email" value={form.email}
        onChange={handleChange} className="w-full border rounded px-3 py-2" />
      <input name="password" type="password" placeholder="Password" value={form.password}
        onChange={handleChange} className="w-full border rounded px-3 py-2" />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={loading}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      <p className="text-center text-sm text-gray-500">
        New rider?{' '}
        <Link href="/register" className="text-blue-500 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
