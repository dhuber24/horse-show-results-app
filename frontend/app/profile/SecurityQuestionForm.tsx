'use client';

import { useEffect, useState } from 'react';

interface Status {
  question: string | null;
  set_at: string | null;
}

const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' };

export default function SecurityQuestionForm() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '', current_password: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const res = await fetch('/api/profile/security-question');
    if (res.ok) setStatus(await res.json());
  };

  useEffect(() => {
    load();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const reset = () => {
    setForm({ question: '', answer: '', current_password: '' });
    setOpen(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.question.trim() || !form.answer.trim() || !form.current_password) {
      setError('All fields are required.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch('/api/profile/security-question', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: form.question.trim(),
        answer: form.answer,
        current_password: form.current_password,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || data.error || 'Failed to save security question.');
      return;
    }
    reset();
    setSuccess('Security question saved.');
    setTimeout(() => setSuccess(null), 4000);
    load();
  };

  const handleRemove = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/profile/security-question', { method: 'DELETE' });
    setLoading(false);
    setConfirmingRemove(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || data.error || 'Failed to remove security question.');
      return;
    }
    setSuccess('Security question removed.');
    setTimeout(() => setSuccess(null), 4000);
    load();
  };

  const hasQuestion = status?.question != null;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: '#8b7355' }}>
        Lets you reset your own password if you forget it. Pick something only you would know &mdash; anyone
        who can answer it can take over your account.
      </p>

      {success && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
          {success}
        </p>
      )}

      {status && !open && (
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#f5efe4' }}>
          {hasQuestion ? (
            <>
              <p className="text-sm font-medium" style={{ color: '#2c1810' }}>{status.question}</p>
              {status.set_at && (
                <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                  Set {new Date(status.set_at).toLocaleDateString()}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm" style={{ color: '#8b7355' }}>
              No security question set. Without one, only an administrator can reset your password.
            </p>
          )}
        </div>
      )}

      {!open && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setOpen(true); setConfirmingRemove(false); }}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
          >
            {hasQuestion ? 'Change Security Question' : 'Set Security Question'}
          </button>
          {hasQuestion && !confirmingRemove && (
            <button
              onClick={() => setConfirmingRemove(true)}
              className="text-sm hover:underline"
              style={{ color: '#8b7355' }}
            >
              Remove
            </button>
          )}
          {hasQuestion && confirmingRemove && (
            <span className="flex items-center gap-2 text-sm" style={{ color: '#8b1a1a' }}>
              Remove it? You&rsquo;ll need an administrator to reset your password.
              <button onClick={handleRemove} disabled={loading} className="font-medium hover:underline disabled:opacity-50">
                Yes, remove
              </button>
              <button onClick={() => setConfirmingRemove(false)} className="hover:underline" style={{ color: '#8b7355' }}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Question</label>
            <input
              name="question"
              type="text"
              value={form.question}
              onChange={handleChange}
              placeholder="What was the name of my first horse?"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Answer</label>
            {/* Shown in the clear on purpose: this is the one chance to check
                what was typed, and it is never displayed again afterwards. */}
            <input
              name="answer"
              type="text"
              value={form.answer}
              onChange={handleChange}
              placeholder="Your answer"
              className={inputClass}
              style={inputStyle}
            />
            <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
              Capitalization and extra spaces don&rsquo;t matter when you answer it later.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>Current Password</label>
            <input
              name="current_password"
              type="password"
              value={form.current_password}
              onChange={handleChange}
              placeholder="••••••••"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          {error && (
            <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
              style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
            >
              {loading ? 'Saving…' : 'Save Security Question'}
            </button>
            <button
              onClick={reset}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
              style={{ color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
