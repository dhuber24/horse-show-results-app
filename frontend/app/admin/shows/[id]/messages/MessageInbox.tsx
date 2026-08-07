'use client';

import { useMemo, useState } from 'react';

export type ContactMessage = {
  id: string;
  show_id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  subject: string | null;
  message: string;
  status: 'new' | 'read' | 'archived';
  handled_at: string | null;
  created_at: string | null;
};

type Filter = 'open' | 'archived' | 'all';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * The show's inbox. Messages arrive from the public contact form, including
 * from people with no account — so every field here is self-reported text and
 * is rendered as such. Replying happens in the reader's own mail client via
 * the mailto link; the app does not send mail.
 */
export default function MessageInbox({
  showId,
  initialMessages,
}: {
  showId: string;
  initialMessages: ContactMessage[];
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

  const setStatus = async (id: string, status: ContactMessage['status']) => {
    setError(null);
    setBusyId(id);
    const res = await fetch(`/api/shows/${showId}/contact/messages/${id}`, {
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
    setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
  };

  if (messages.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center"
        style={{ borderColor: '#d4b896' }}
      >
        <p className="text-sm font-medium" style={{ color: '#2c1810' }}>No messages yet</p>
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          Anyone viewing this show&rsquo;s page can send the office a question, with or without an
          account. Their messages land here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: '#8b7355' }}>
          {unread > 0 ? `${unread} unread` : 'Nothing unread'} · {messages.length} total
        </p>
        <div className="flex gap-2">
          {(['open', 'archived', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition"
              style={filter === f
                ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
                : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }}
            >
              {f === 'open' ? 'Open' : f === 'archived' ? 'Archived' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          className="rounded border p-2 text-xs"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
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
                  borderColor: isNew ? '#8b4513' : '#e8d5b7',
                  backgroundColor: isNew ? '#fffdf8' : '#fdfbf7',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold flex items-center flex-wrap gap-1.5" style={{ color: '#2c1810' }}>
                      {m.subject || '(no subject)'}
                      {isNew && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                        >
                          New
                        </span>
                      )}
                      {m.status === 'archived' && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
                        >
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                      {m.sender_name} · {m.sender_email}
                      {m.sender_phone && <> · {m.sender_phone}</>}
                    </p>
                    <p className="text-xs" style={{ color: '#8b7355' }}>{formatWhen(m.created_at)}</p>
                  </div>
                </div>

                {/* whitespace-pre-wrap: they typed paragraphs, show paragraphs. */}
                <p
                  className="text-sm mt-3 whitespace-pre-wrap break-words"
                  style={{ color: '#2c1810' }}
                >
                  {m.message}
                </p>

                <div
                  className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t"
                  style={{ borderColor: '#f0e4d0' }}
                >
                  <a
                    href={`mailto:${encodeURIComponent(m.sender_email)}?subject=${encodeURIComponent(
                      `Re: ${m.subject || 'your message about this show'}`,
                    )}`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Reply by email
                  </a>
                  {m.status !== 'read' && (
                    <button
                      onClick={() => setStatus(m.id, 'read')}
                      disabled={busyId === m.id}
                      className="text-xs font-medium hover:underline disabled:opacity-50"
                      style={{ color: '#8b4513' }}
                    >
                      Mark read
                    </button>
                  )}
                  {m.status === 'read' && (
                    <button
                      onClick={() => setStatus(m.id, 'new')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: '#8b7355' }}
                      title="Put it back in the unread pile"
                    >
                      Mark unread
                    </button>
                  )}
                  {m.status !== 'archived' ? (
                    <button
                      onClick={() => setStatus(m.id, 'archived')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: '#8b7355' }}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(m.id, 'read')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: '#8b7355' }}
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
