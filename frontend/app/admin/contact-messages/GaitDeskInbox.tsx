'use client';

import { useMemo, useState } from 'react';
import LocalTime from '@/components/LocalTime';

export type GaitDeskMessage = {
  id: string;
  topic: string;
  topic_label: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  organization: string | null;
  subject: string | null;
  message: string;
  status: 'new' | 'read' | 'archived';
  /** The account it was sent from — stamped by the backend from the session,
   *  so unlike every typed field here it is not self-reported. */
  sender_account: { id: string; name: string; email: string; role: string } | null;
  handled_at: string | null;
  created_at: string | null;
};

type Filter = 'open' | 'archived' | 'all';

const WHEN: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
};

const ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
  SCRIBE: 'Scribe',
  GATE_STEWARD: 'Gate Steward',
  EXHIBITOR: 'Exhibitor',
  TRAINER: 'Trainer',
  JUDGE: 'Judge',
};

/**
 * GaitDesk's own inbox — the show inbox (`components/MessageInbox.tsx`) one
 * level up, with the same Open / Archived / All views and the same actions.
 * Replying happens in the reader's mail client; the app sends no reply.
 *
 * What differs is the badge. A show's inbox asks whether the sender is entered
 * at that show; here the question is whether they had an account at all, and
 * which — a show secretary asking about pricing is a customer, a stranger is
 * a lead.
 */
export default function GaitDeskInbox({ initialMessages }: { initialMessages: GaitDeskMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [filter, setFilter] = useState<Filter>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (filter === 'all') return messages;
    if (filter === 'archived') return messages.filter((m) => m.status === 'archived');
    return messages.filter((m) => m.status !== 'archived');
  }, [messages, filter]);

  const unread = messages.filter((m) => m.status === 'new').length;

  const setStatus = async (message: GaitDeskMessage, status: GaitDeskMessage['status']) => {
    setError(null);
    setBusyId(message.id);
    try {
      const res = await fetch(`/api/gaitdesk-contact/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError('Could not update that message. Try again.');
        return;
      }
      const updated: GaitDeskMessage = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === message.id ? updated : m)));
    } catch {
      setError('Could not update that message. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>No messages yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Anybody can write to GaitDesk from the Contact page, with or without an account. Their messages land here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {unread > 0 ? `${unread} unread` : 'Nothing unread'} · {messages.length} total
        </p>
        <div className="flex gap-2">
          {(['open', 'archived', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition"
              style={filter === f
                ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--surface)' }
                : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              {f === 'open' ? 'Open' : f === 'archived' ? 'Archived' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          className="rounded border p-2 text-xs"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing in this view.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((m) => {
            const isNew = m.status === 'new';
            const busy = busyId === m.id;
            return (
              <li
                key={m.id}
                className="rounded-lg border p-4"
                style={{ borderColor: isNew ? 'var(--accent)' : 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
                  {m.topic_label}
                </p>
                <div className="text-sm font-semibold flex items-center flex-wrap gap-1.5" style={{ color: 'var(--foreground)' }}>
                  {m.subject || '(no subject)'}
                  {isNew && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
                      New
                    </span>
                  )}
                  {m.status === 'archived' && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5 flex items-center flex-wrap gap-1.5" style={{ color: 'var(--muted)' }}>
                  <span>
                    {m.sender_name} · {m.sender_email}
                    {m.sender_phone && <> · {m.sender_phone}</>}
                    {m.organization && <> · {m.organization}</>}
                  </span>
                  {m.sender_account && (
                    <span
                      className="px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
                      title={`Signed in as ${m.sender_account.name} (${m.sender_account.email}) when they sent this.`}
                    >
                      {ROLE_NAMES[m.sender_account.role] ?? m.sender_account.role} account
                    </span>
                  )}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {m.created_at && <LocalTime iso={m.created_at} format={WHEN} />}
                </p>

                {/* whitespace-pre-wrap: they typed paragraphs, show paragraphs. */}
                <p className="text-sm mt-3 whitespace-pre-wrap break-words" style={{ color: 'var(--foreground)' }}>
                  {m.message}
                </p>

                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
                  <a
                    href={`mailto:${encodeURIComponent(m.sender_email)}?subject=${encodeURIComponent(
                      `Re: ${m.subject || m.topic_label}`,
                    )}`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Reply by email
                  </a>
                  {m.status !== 'read' && m.status !== 'archived' && (
                    <button onClick={() => setStatus(m, 'read')} disabled={busy}
                      className="text-xs font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                      Mark read
                    </button>
                  )}
                  {m.status === 'read' && (
                    <button onClick={() => setStatus(m, 'new')} disabled={busy}
                      className="text-xs hover:underline disabled:opacity-50" style={{ color: 'var(--muted)' }}
                      title="Put it back in the unread pile">
                      Mark unread
                    </button>
                  )}
                  {m.status !== 'archived' ? (
                    <button onClick={() => setStatus(m, 'archived')} disabled={busy}
                      className="text-xs hover:underline disabled:opacity-50" style={{ color: 'var(--muted)' }}>
                      Archive
                    </button>
                  ) : (
                    <button onClick={() => setStatus(m, 'read')} disabled={busy}
                      className="text-xs hover:underline disabled:opacity-50" style={{ color: 'var(--muted)' }}>
                      Unarchive
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
