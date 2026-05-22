'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function TrainerRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    private_phone: '',
    public_email: '',
    public_phone: '',
    password: '',
    confirm_password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

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
        public_email: form.public_email || null,
        public_phone: form.public_phone || null,
        password: form.password,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Registration failed.');
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

    router.push('/profile');
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {[
          { name: 'first_name', label: 'First Name', type: 'text', placeholder: 'Jane' },
          { name: 'last_name', label: 'Last Name', type: 'text', placeholder: 'Smith' },
          { name: 'email', label: 'Private Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'private_phone', label: 'Private Phone', type: 'tel', placeholder: '(555) 123-4567' },
          { name: 'public_email', label: 'Public Email', type: 'email', placeholder: 'public@example.com (optional)' },
          { name: 'public_phone', label: 'Public Phone', type: 'tel', placeholder: '(555) 987-6543 (optional)' },
          { name: 'password', label: 'Password', type: 'password', placeholder: 'Min 8 characters' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: 'Re-enter password' },
        ].map((field) => (
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
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: '#d4b896', backgroundColor: '#fdf6ee' }}>
        <p className="font-medium mb-1" style={{ color: '#2c1810' }}>What this creates</p>
        <p style={{ color: '#5a3e2b' }}>
          Your login is created with the Trainer role and linked to the trainer registry used on horse profiles.
          Private contact fields are required for account/admin use. Public contact fields are optional and can be shown with your trainer record.
        </p>
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
        {loading ? 'Creating account...' : 'Create Trainer Account'}
      </button>
    </div>
  );
}
