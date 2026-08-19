'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'question' | 'password';

const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2';
const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' };

function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const palette = {
    error: { backgroundColor: '#fdf0f0', color: '#8b1a1a' },
    success: { backgroundColor: '#f0fdf0', color: '#166534' },
    info: { backgroundColor: '#f5efe4', color: '#5a3e2b' },
  }[kind];
  return <p className="text-sm px-3 py-2 rounded" style={palette}>{children}</p>;
}

function Field({
  label, name, type, value, onChange, placeholder, autoFocus,
}: {
  label: string;
  name: string;
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>{label}</label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={inputClass}
        style={inputStyle}
      />
    </div>
  );
}

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('question');
  // The question arrives from the server between the two steps, so holding it in
  // state is what distinguishes "asked for an email" from "waiting on an answer".
  const [question, setQuestion] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '',
    answer: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [noQuestionOnFile, setNoQuestionOnFile] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNoQuestionOnFile(false);
    setQuestion(null);
  };

  const validNewPassword = () => {
    if (form.new_password !== form.confirm_password) {
      setError('New passwords do not match.');
      return false;
    }
    if (form.new_password.length < 8) {
      setError('New password must be at least 8 characters.');
      return false;
    }
    return true;
  };

  const finish = () => {
    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  };

  const lookUpQuestion = async () => {
    if (!form.email) {
      setError('Enter your email.');
      return;
    }
    setLoading(true);
    setError(null);
    setNoQuestionOnFile(false);
    const res = await fetch('/api/auth/password-reset/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      // 404 is an ordinary outcome, not a fault: every account created before
      // this feature has no question. Say what to do next, not just what failed.
      if (res.status === 404) setNoQuestionOnFile(true);
      setError(data.error || 'Could not look up that account.');
      return;
    }
    setQuestion(data.question);
  };

  const submitAnswer = async () => {
    if (!form.answer || !form.new_password || !form.confirm_password) {
      setError('All fields are required.');
      return;
    }
    if (!validNewPassword()) return;
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/password-reset/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        answer: form.answer,
        new_password: form.new_password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || 'Failed to reset password.');
      // A lockout ends this attempt. Dropping back to the email step stops the
      // form inviting guesses the backend is going to refuse.
      if (res.status === 429) setQuestion(null);
      return;
    }
    finish();
  };

  const submitCurrentPassword = async () => {
    if (!form.email || !form.current_password || !form.new_password || !form.confirm_password) {
      setError('All fields are required.');
      return;
    }
    if (!validNewPassword()) return;
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        current_password: form.current_password,
        new_password: form.new_password,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to reset password.');
      return;
    }
    finish();
  };

  if (success) {
    return <Notice kind="success">Password updated. Redirecting to sign in...</Notice>;
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border overflow-hidden text-sm" style={{ borderColor: '#d4b896' }}>
        {([
          ['question', 'Answer my security question'],
          ['password', 'I know my password'],
        ] as [Mode, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => switchMode(value)}
            className="flex-1 px-3 py-2 font-medium transition"
            style={{
              backgroundColor: mode === value ? '#8b4513' : '#ffffff',
              color: mode === value ? '#ffffff' : '#8b7355',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'question' && !question && (
        <>
          <Field
            label="Email" name="email" type="email" placeholder="you@example.com"
            value={form.email} onChange={handleChange} autoFocus
          />
          {error && <Notice kind="error">{error}</Notice>}
          {noQuestionOnFile && (
            <Notice kind="info">
              If you know your current password, use <strong>I know my password</strong> above. Otherwise ask
              a show administrator to reset it for you, then set a security question on your profile.
            </Notice>
          )}
          <button
            onClick={lookUpQuestion}
            disabled={loading}
            className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
          >
            {loading ? 'Checking...' : 'Continue'}
          </button>
        </>
      )}

      {mode === 'question' && question && (
        <>
          <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#f5efe4' }}>
            <p className="text-xs uppercase tracking-wide" style={{ color: '#8b7355' }}>Your security question</p>
            <p className="text-sm font-medium mt-0.5" style={{ color: '#2c1810' }}>{question}</p>
          </div>
          <Field
            label="Answer" name="answer" type="text" placeholder="Your answer"
            value={form.answer} onChange={handleChange} autoFocus
          />
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Capitalization and extra spaces don&rsquo;t matter.
          </p>
          <Field
            label="New Password" name="new_password" type="password" placeholder="••••••••"
            value={form.new_password} onChange={handleChange}
          />
          <Field
            label="Confirm New Password" name="confirm_password" type="password" placeholder="••••••••"
            value={form.confirm_password} onChange={handleChange}
          />
          {error && <Notice kind="error">{error}</Notice>}
          <button
            onClick={submitAnswer}
            disabled={loading}
            className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
          >
            {loading ? 'Updating...' : 'Reset Password'}
          </button>
          <button
            onClick={() => { setQuestion(null); setError(null); setForm((p) => ({ ...p, answer: '' })); }}
            disabled={loading}
            className="w-full text-sm hover:underline disabled:opacity-50"
            style={{ color: '#8b7355' }}
          >
            Use a different email
          </button>
        </>
      )}

      {mode === 'password' && (
        <>
          <Field
            label="Email" name="email" type="email" placeholder="you@example.com"
            value={form.email} onChange={handleChange} autoFocus
          />
          <Field
            label="Current Password" name="current_password" type="password" placeholder="••••••••"
            value={form.current_password} onChange={handleChange}
          />
          <Field
            label="New Password" name="new_password" type="password" placeholder="••••••••"
            value={form.new_password} onChange={handleChange}
          />
          <Field
            label="Confirm New Password" name="confirm_password" type="password" placeholder="••••••••"
            value={form.confirm_password} onChange={handleChange}
          />
          {error && <Notice kind="error">{error}</Notice>}
          <button
            onClick={submitCurrentPassword}
            disabled={loading}
            className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </>
      )}
    </div>
  );
}
