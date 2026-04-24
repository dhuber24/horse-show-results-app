'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface ShowType {
  id: string;
  code: string;
  name: string;
}

interface CertEntry {
  show_type_id: string;
  secretary_id_number: string;
}

export default function ShowSecretaryRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm_password: '' });
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);
  const [certifications, setCertifications] = useState<Record<string, CertEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/show-types')
      .then((r) => r.json())
      .then((data) => setShowTypes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const toggleShowType = (st: ShowType) => {
    setCertifications((prev) => {
      if (prev[st.id]) {
        const next = { ...prev };
        delete next[st.id];
        return next;
      }
      return { ...prev, [st.id]: { show_type_id: st.id, secretary_id_number: '' } };
    });
  };

  const handleSecretaryId = (showTypeId: string, value: string) => {
    setCertifications((prev) => ({
      ...prev,
      [showTypeId]: { ...prev[showTypeId], secretary_id_number: value },
    }));
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

    const res = await fetch('/api/auth/register/show-secretary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        certifications: Object.values(certifications),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Registration failed.');
      setLoading(false);
      return;
    }

    await signIn('credentials', { email: form.email, password: form.password, redirect: false });
    router.push('/');
    router.refresh();
  };

  const selectedCount = Object.keys(certifications).length;

  return (
    <div className="space-y-5">
      {/* Account fields */}
      <div className="space-y-4">
        {[
          { name: 'full_name', label: 'Full Name', type: 'text', placeholder: 'Jane Smith' },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'password', label: 'Password', type: 'password', placeholder: '•••••••• (min 8 chars)' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
        ].map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>{field.label}</label>
            <input
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              value={(form as any)[field.name]}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
            />
          </div>
        ))}
      </div>

      {/* Show type certifications */}
      <div>
        <div className="mb-3">
          <p className="text-sm font-semibold" style={{ color: '#2c1810' }}>Show Type Certifications</p>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            Select the show type(s) you are certified for and enter your Secretary ID for each.
          </p>
        </div>
        {showTypes.length === 0 ? (
          <p className="text-xs" style={{ color: '#8b7355' }}>Loading show types…</p>
        ) : (
          <div className="space-y-3">
            {showTypes.map((st) => {
              const checked = !!certifications[st.id];
              return (
                <div key={st.id} className="rounded-lg border p-3" style={{ borderColor: checked ? '#8b4513' : '#d4b896', backgroundColor: checked ? '#fdf6ee' : '#faf7f2' }}>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleShowType(st)}
                      className="w-4 h-4 rounded"
                      style={{ accentColor: '#8b4513' }}
                    />
                    <span className="text-sm font-medium" style={{ color: '#2c1810' }}>
                      {st.name}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: '#e8d5b7', color: '#5c3d1e' }}>
                      {st.code}
                    </span>
                  </label>
                  {checked && (
                    <div className="mt-2 ml-6">
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>
                        {st.code} Secretary ID
                      </label>
                      <input
                        type="text"
                        placeholder={`Your ${st.code} Secretary ID`}
                        value={certifications[st.id].secretary_id_number}
                        onChange={(e) => handleSecretaryId(st.id, e.target.value)}
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                        style={{ borderColor: '#c9a67a', backgroundColor: '#ffffff' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {selectedCount === 0 && (
          <p className="text-xs mt-2" style={{ color: '#8b7355' }}>
            No certifications selected — you can add them later from your profile.
          </p>
        )}
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
        {loading ? 'Creating account…' : 'Create Show Secretary Account'}
      </button>
    </div>
  );
}
