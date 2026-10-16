'use client';

import { useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api-error';

export type ContactTopic = { key: string; label: string };

/**
 * Send GaitDesk a message. Built on the show office's form
 * (`shows/[id]/contact/ContactShowForm.tsx`) and kept to its rules: reachable
 * with no account, stored rather than only emailed, so the success copy
 * promises what actually happened; and a signed-in sender's identity comes
 * from the session on the server, not from anything here.
 *
 * Two things it adds. A **topic**, required, so the admins reading the inbox
 * can see at a glance what each message is about — the list comes from the
 * backend (`GET /gaitdesk-contact/topics`). And a **hidden field** no person can
 * see or tab to: a form-filling bot fills it, and the backend quietly drops the
 * message (see `routers/gaitdesk_contact.py`).
 */
export default function ContactGaitDeskForm({
  topics,
  defaultTopic = '',
  defaultName = '',
  defaultEmail = '',
}: {
  topics: ContactTopic[];
  /** From `?topic=` — a link that already knows what the question is about,
   *  like the FAQ's pricing answer. Changeable like the rest. */
  defaultTopic?: string;
  /** Prefilled from the signed-in account, and editable: the reply-to address
   *  somebody wants is not always the one they signed up with. */
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [form, setForm] = useState({
    topic: defaultTopic,
    sender_name: defaultName,
    sender_email: defaultEmail,
    sender_phone: '',
    organization: '',
    subject: '',
    message: '',
    website: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const missing = [
    !form.topic && 'what it is about',
    !form.sender_name.trim() && 'your name',
    !form.sender_email.trim() && 'your email',
    !form.message.trim() && 'a message',
  ].filter(Boolean) as string[];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/gaitdesk-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          sender_name: form.sender_name.trim(),
          sender_email: form.sender_email.trim(),
          sender_phone: form.sender_phone.trim() || null,
          organization: form.organization.trim() || null,
          subject: form.subject.trim() || null,
          message: form.message.trim(),
          website: form.website || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(
          res.status === 429
            ? 'A lot of messages have been sent just now — please wait a minute and try again.'
            : errorMessage(json, 'Your message could not be sent. Please try again.'),
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
        style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: 'var(--success-strong)' }}>Message sent</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--success)' }}>
          Your message is in GaitDesk&rsquo;s inbox. We&rsquo;ll reply to {form.sender_email} — keep an
          eye on your spam folder in case the reply lands there.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/"
            className="text-sm font-medium px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--success-strong)', color: 'var(--success-bg)' }}
          >
            Back to Home
          </Link>
          <button
            onClick={() => {
              setSent(false);
              setForm((prev) => ({ ...prev, subject: '', message: '' }));
            }}
            className="text-sm font-medium px-3 py-2 rounded border"
            style={{ borderColor: 'var(--success-border)', color: 'var(--success-strong)', backgroundColor: 'var(--surface)' }}
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  const inputClass = 'mt-1 w-full border rounded px-3 py-2 text-sm';
  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 relative">
      <label className="text-xs block" style={{ color: 'var(--muted)' }}>
        What is this about? <span style={{ color: 'var(--error)' }}>*</span>
        <select required value={form.topic} onChange={set('topic')} className={inputClass} style={inputStyle}>
          <option value="" disabled>Choose one…</option>
          {topics.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Your name <span style={{ color: 'var(--error)' }}>*</span>
          <input required maxLength={120} autoComplete="name" value={form.sender_name}
            onChange={set('sender_name')} className={inputClass} style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Your email <span style={{ color: 'var(--error)' }}>*</span>
          <input required type="email" autoComplete="email" value={form.sender_email}
            onChange={set('sender_email')} placeholder="so we can reply" className={inputClass} style={inputStyle} />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Phone (optional)
          <input type="tel" maxLength={40} autoComplete="tel" value={form.sender_phone}
            onChange={set('sender_phone')} className={inputClass} style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Club or company (optional)
          <input maxLength={150} autoComplete="organization" value={form.organization}
            onChange={set('organization')} placeholder="if you run shows" className={inputClass} style={inputStyle} />
        </label>
      </div>

      <label className="text-xs block" style={{ color: 'var(--muted)' }}>
        Subject (optional)
        <input maxLength={150} value={form.subject} onChange={set('subject')}
          className={inputClass} style={inputStyle} />
      </label>

      <label className="text-xs block" style={{ color: 'var(--muted)' }}>
        Message <span style={{ color: 'var(--error)' }}>*</span>
        <textarea required rows={6} maxLength={4000} value={form.message} onChange={set('message')}
          placeholder="How can we help?" className={inputClass} style={inputStyle} />
        <span className="block text-right mt-0.5">{form.message.length}/4000</span>
      </label>

      {/* The honeypot: off-screen, out of the tab order and hidden from screen
          readers, so only a bot filling every field it finds fills this. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={set('website')} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending || missing.length > 0}
          className="px-4 py-2 rounded font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          title={missing.length > 0 ? `Add ${missing.join(', ')} first` : undefined}
        >
          {sending ? 'Sending…' : 'Send message'}
        </button>
        <Link href="/faq" className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
          Cancel
        </Link>
      </div>

      {error && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
