'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import LocalTime from './LocalTime';

export type ContactMessage = {
  id: string;
  show_id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  subject: string | null;
  message: string;
  status: 'new' | 'read' | 'archived';
  /** Set when the sender was signed in. The backend stamps it from the
   *  session, never from the message body, so unlike everything else here it
   *  is not self-reported. */
  sender_exhibitor_id: string | null;
  /** Their back number at *this* show, when they have one. */
  sender_back_number: number | null;
  /** They have a `show_entries` row here — signed up or entered by the office. */
  sender_is_registered: boolean;
  handled_at: string | null;
  created_at: string | null;
  /** Which show it was sent to. Only on the combined inbox (`/admin/messages`,
   *  `GET /my-messages`), where one list mixes shows. */
  show_name?: string;
};

type Filter = 'open' | 'archived' | 'all';

// Printed through LocalTime: formatted on the server this was the container's
// UTC, hours out for the office reading it, and a hydration mismatch besides.
const WHEN: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
};

/**
 * A show's inbox, or every show's at once. Messages arrive from the contact form, including from
 * people with no account — so every field the sender typed is self-reported
 * text and is rendered as such. Replying happens in the reader's own mail
 * client via the mailto link; the app does not send mail.
 *
 * The one exception is the entrant badge. `sender_is_registered` and
 * `sender_back_number` come from the session the message was sent under, not
 * from anything typed, which is the entire point: a secretary reading "Sarah
 * Mitchell" cannot otherwise tell the Sarah Mitchell holding back number 42
 * from someone who has never been here, and the answer to the question usually
 * depends on that. An unbadged message is not suspicious — it is the ordinary
 * case of a stranger asking about stalls.
 *
 * `combined` is the inbox across every show the reader works: each message
 * names its show, and Mark read / Archive still go to that show's own endpoint
 * — the message carries its `show_id`, so there is one writer either way.
 */
export default function MessageInbox({
  initialMessages,
  combined = false,
}: {
  initialMessages: ContactMessage[];
  combined?: boolean;
}) {
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

  const setStatus = async (message: ContactMessage, status: ContactMessage['status']) => {
    const { id } = message;
    setError(null);
    setBusyId(id);
    const res = await fetch(`/api/shows/${message.show_id}/contact/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError('Could not update that message. Try again.');
      return;
    }
    const updated: ContactMessage = await res.json();
    // The per-show endpoint does not send the show's name back; keep ours.
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...updated, show_name: m.show_name } : m)),
    );
  };

  if (messages.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>No messages yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {combined
            ? 'Anyone viewing the page of a show you work can send its office a question, with or without an account. Every show’s messages land here.'
            : 'Anyone viewing this show’s page can send the office a question, with or without an account. Their messages land here.'}
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
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Nothing in this view.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((m) => {
            const isNew = m.status === 'new';
            return (
              <li
                key={m.id}
                className="rounded-lg border p-4"
                style={{
                  borderColor: isNew ? 'var(--accent)' : 'var(--border-subtle)',
                  backgroundColor: isNew ? 'var(--surface)' : 'var(--surface)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {combined && m.show_name && (
                      <Link
                        href={`/admin/shows/${m.show_id}/messages`}
                        className="block text-xs font-semibold uppercase tracking-wide mb-1 hover:underline"
                        style={{ color: 'var(--accent)' }}
                        title="This show's own inbox"
                      >
                        {m.show_name}
                      </Link>
                    )}
                    <div className="text-sm font-semibold flex items-center flex-wrap gap-1.5" style={{ color: 'var(--foreground)' }}>
                      {m.subject || '(no subject)'}
                      {isNew && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
                        >
                          New
                        </span>
                      )}
                      {m.status === 'archived' && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
                        >
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 flex items-center flex-wrap gap-1.5"
                      style={{ color: 'var(--muted)' }}>
                      <span>
                        {m.sender_name} · {m.sender_email}
                        {m.sender_phone && <> · {m.sender_phone}</>}
                      </span>
                      {m.sender_is_registered ? (
                        <span
                          className="px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
                          title="Signed in when they sent this, and entered at this show."
                        >
                          {m.sender_back_number != null
                            ? `Back #${m.sender_back_number}`
                            : 'Entered here'}
                        </span>
                      ) : m.sender_exhibitor_id ? (
                        <span
                          className="px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--accent-border)', color: 'var(--accent-hover)' }}
                          title="Signed in when they sent this, but has no entry at this show."
                        >
                          Has an account
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {m.created_at && <LocalTime iso={m.created_at} format={WHEN} />}
                    </p>
                  </div>
                </div>

                {/* whitespace-pre-wrap: they typed paragraphs, show paragraphs. */}
                <p
                  className="text-sm mt-3 whitespace-pre-wrap break-words"
                  style={{ color: 'var(--foreground)' }}
                >
                  {m.message}
                </p>

                <div
                  className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t"
                  style={{ borderColor: 'var(--bg-subtle)' }}
                >
                  <a
                    href={`mailto:${encodeURIComponent(m.sender_email)}?subject=${encodeURIComponent(
                      `Re: ${m.subject || 'your message about this show'}`,
                    )}`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Reply by email
                  </a>
                  {m.status !== 'read' && (
                    <button
                      onClick={() => setStatus(m, 'read')}
                      disabled={busyId === m.id}
                      className="text-xs font-medium hover:underline disabled:opacity-50"
                      style={{ color: 'var(--accent)' }}
                    >
                      Mark read
                    </button>
                  )}
                  {m.status === 'read' && (
                    <button
                      onClick={() => setStatus(m, 'new')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                      title="Put it back in the unread pile"
                    >
                      Mark unread
                    </button>
                  )}
                  {m.status !== 'archived' ? (
                    <button
                      onClick={() => setStatus(m, 'archived')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(m, 'read')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                    >
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
