'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';

const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

/**
 * The Contact Trainer button's form, on a Pro listing. The message lands in the
 * trainer's GaitDesk inbox and they are emailed a notice; they reply to the
 * address given here — the trainer's own is never shown.
 */
export default function ContactTrainerForm({ trainerId, trainerName }: { trainerId: string; trainerName: string }) {
  const [form, setForm] = useState({ sender_name: '', sender_email: '', sender_phone: '', message: '', website: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sender_name.trim() || !form.sender_email.trim() || !form.message.trim()) {
      setError('Your name, email and a message are needed.');
      return;
    }
    setSending(true);
    setError(null);
    const res = await fetch(`/api/trainers/${trainerId}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_name: form.sender_name.trim(),
        sender_email: form.sender_email.trim(),
        sender_phone: form.sender_phone.trim() || null,
        message: form.message.trim(),
        website: form.website || null,
      }),
    }).catch(() => null);
    setSending(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(errorMessage(body, 'Your message could not be sent. Try again in a moment.'));
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <p className="text-sm rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}>
        Sent. {trainerName} will reply to {form.sender_email.trim()}.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="lead-name" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Your name</label>
          <input id="lead-name" value={form.sender_name} onChange={update('sender_name')} maxLength={120} autoComplete="name" className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lead-email" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Your email</label>
          <input id="lead-email" type="email" value={form.sender_email} onChange={update('sender_email')} maxLength={200} autoComplete="email" className={inputClass} style={inputStyle} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lead-phone" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
            Your phone <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
          </label>
          <input id="lead-phone" type="tel" value={form.sender_phone} onChange={update('sender_phone')} maxLength={30} autoComplete="tel" className={inputClass} style={inputStyle} />
        </div>
      </div>
      <div>
        <label htmlFor="lead-message" className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Message</label>
        <textarea
          id="lead-message"
          value={form.message}
          onChange={update('message')}
          rows={4}
          maxLength={4000}
          placeholder="Tell them about you and your horse, and what you're looking for."
          className={inputClass}
          style={inputStyle}
        />
      </div>
      {/* Hidden from people; only a bot fills it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor="lead-website">Website</label>
        <input id="lead-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update('website')} />
      </div>
      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={sending}
        title={sending ? 'Sending your message…' : undefined}
        className="text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
      >
        {sending ? 'Sending…' : `Send to ${trainerName}`}
      </button>
    </form>
  );
}
