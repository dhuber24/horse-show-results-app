'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Message the show office. Reachable with no account — that is the point, so
 * nothing here asks the sender to sign in or verify anything.
 *
 * Messages land in the show's inbox rather than being emailed. `mailer.py` is
 * best-effort and does nothing without SMTP configured, and the one failure a
 * contact form must not have is accepting a message, saying "sent", and losing
 * it. The success copy therefore promises what actually happened.
 *
 * When the sender *is* signed in the route handler forwards the session and
 * the backend stamps who they are (migration 103). Nothing in this form says
 * so, because nothing in this form can affect it — the identity is not one of
 * the fields.
 */
export default function ContactShowForm({
  showId,
  showName,
  defaultName = '',
  defaultEmail = '',
}: {
  showId: string;
  showName: string;
  /** Prefilled from the signed-in account. Editable rather than locked: the
   *  reply-to address a person wants is not always the one they signed up
   *  with, and the backend stamps the real identity from the session anyway —
   *  so what they type here is a contact preference, not a claim. */
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [form, setForm] = useState({
    sender_name: defaultName,
    sender_email: defaultEmail,
    sender_phone: '',
    subject: '',
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const canSend =
    form.sender_name.trim().length > 0 &&
    form.sender_email.trim().length > 0 &&
    form.message.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/shows/${showId}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_name: form.sender_name.trim(),
          sender_email: form.sender_email.trim(),
          sender_phone: form.sender_phone.trim() || null,
          subject: form.subject.trim() || null,
          message: form.message.trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(
          res.status === 429
            ? 'You have sent several messages just now — please wait a minute and try again.'
            : typeof json?.detail === 'string'
              ? json.detail
              : 'Your message could not be sent. Please try again.',
        );
        setSending(false);
        return;
      }
      setSent(true);
      setSending(false);
    } catch {
      setError('Network error — please try again.');
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div
        className="rounded-lg border p-5"
        style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: '#065f46' }}>Message sent</h2>
        <p className="text-sm mt-2" style={{ color: '#15803d' }}>
          Your message is in the show office&rsquo;s inbox for <strong>{showName}</strong>. They
          will reply to {form.sender_email}. Keep an eye on your spam folder in case their reply
          lands there.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/shows/${showId}`}
            className="text-sm font-medium px-3 py-2 rounded"
            style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
          >
            Back to the show
          </Link>
          <button
            onClick={() => {
              setSent(false);
              setForm((prev) => ({ ...prev, subject: '', message: '' }));
            }}
            className="text-sm font-medium px-3 py-2 rounded border"
            style={{ borderColor: '#86efac', color: '#166534', backgroundColor: '#ffffff' }}
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Your name <span style={{ color: '#b91c1c' }}>*</span>
          <input
            required
            maxLength={120}
            value={form.sender_name}
            onChange={set('sender_name')}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Your email <span style={{ color: '#b91c1c' }}>*</span>
          <input
            required
            type="email"
            value={form.sender_email}
            onChange={set('sender_email')}
            placeholder="so they can reply"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Phone (optional)
          <input
            maxLength={40}
            value={form.sender_phone}
            onChange={set('sender_phone')}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
        </label>
        <label className="text-xs" style={{ color: '#8b7355' }}>
          Subject (optional)
          <input
            maxLength={150}
            value={form.subject}
            onChange={set('subject')}
            placeholder="e.g. Stall availability"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          />
        </label>
      </div>

      <label className="text-xs block" style={{ color: '#8b7355' }}>
        Message <span style={{ color: '#b91c1c' }}>*</span>
        <textarea
          required
          rows={6}
          maxLength={4000}
          value={form.message}
          onChange={set('message')}
          placeholder="What would you like to ask the show office?"
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
        <span className="block text-right mt-0.5">{form.message.length}/4000</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending || !canSend}
          className="px-4 py-2 rounded font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
          title={!canSend ? 'Add your name, email and a message first' : undefined}
        >
          {sending ? 'Sending…' : 'Send message'}
        </button>
        <Link
          href={`/shows/${showId}`}
          className="text-sm hover:underline"
          style={{ color: '#8b7355' }}
        >
          Cancel
        </Link>
      </div>

      {error && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
