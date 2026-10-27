'use client';

import { useMemo, useState } from 'react';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';

/** `TrainerLeadOut`. */
export interface TrainerMessage {
  id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  message: string;
  status: 'new' | 'read' | 'archived';
  created_at: string;
}

type Filter = 'open' | 'archived' | 'all';

// The outline on the message the notice email linked to (`target:ring-2`).
const LINKED_RING = { '--tw-ring-color': 'var(--accent)' } as React.CSSProperties;

const WHEN: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
};

/**
 * A trainer's inbox: the messages exhibitors send with the Contact Trainer
 * button on their listing (migration 176). Laid out like a show's
 * `MessageInbox` — open, archived or all; mark read, unread, archive — and,
 * like it, replying is the reader's own mail client: the sender left an email
 * address, and GaitDesk sends nothing on the trainer's behalf. Replying marks
 * the message read.
 *
 * Each message is `#lead-{id}`, the anchor the notice email links to, and is
 * outlined when it is the one linked.
 */
export default function TrainerInbox({ initialMessages }: { initialMessages: TrainerMessage[] }) {
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

  const setStatus = async (id: string, status: TrainerMessage['status']) => {
    setError(null);
    setBusyId(id);
    const res = await fetch(`/api/trainers/me/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusyId(null);
    const json = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !json?.id) {
      setError(errorMessage(json, 'Could not update that message. Try again.'));
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? (json as TrainerMessage) : m)));
  };

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>No messages yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          On Pro, exhibitors reach you with the Contact Trainer button on your listing. Each message lands here, and
          you&apos;re emailed a notice.
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
            return (
              <li
                key={m.id}
                id={`lead-${m.id}`}
                className="rounded-lg border p-4 scroll-mt-20 target:ring-2"
                style={{
                  ...LINKED_RING,
                  borderColor: isNew ? 'var(--accent)' : 'var(--border-subtle)',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <div className="text-sm font-semibold flex items-center flex-wrap gap-1.5" style={{ color: 'var(--foreground)' }}>
                  {m.sender_name}
                  {isNew && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
                      New
                    </span>
                  )}
                  {m.status === 'archived' && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {m.sender_email}
                  {m.sender_phone && <> · {m.sender_phone}</>}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  <LocalTime iso={m.created_at} format={WHEN} />
                </p>

                {/* whitespace-pre-wrap: they typed paragraphs, show paragraphs. */}
                <p className="text-sm mt-3 whitespace-pre-wrap break-words" style={{ color: 'var(--foreground)' }}>
                  {m.message}
                </p>

                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
                  <a
                    href={`mailto:${encodeURIComponent(m.sender_email)}?subject=${encodeURIComponent('Re: your message on GaitDesk')}`}
                    onClick={() => { if (isNew) setStatus(m.id, 'read'); }}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Reply by email
                  </a>
                  {m.status !== 'read' && (
                    <button
                      onClick={() => setStatus(m.id, 'read')}
                      disabled={busyId === m.id}
                      title={busyId === m.id ? 'Saving…' : undefined}
                      className="text-xs font-medium hover:underline disabled:opacity-50"
                      style={{ color: 'var(--accent)' }}
                    >
                      Mark read
                    </button>
                  )}
                  {m.status === 'read' && (
                    <button
                      onClick={() => setStatus(m.id, 'new')}
                      disabled={busyId === m.id}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                      title={busyId === m.id ? 'Saving…' : 'Put it back in the unread pile'}
                    >
                      Mark unread
                    </button>
                  )}
                  {m.status !== 'archived' ? (
                    <button
                      onClick={() => setStatus(m.id, 'archived')}
                      disabled={busyId === m.id}
                      title={busyId === m.id ? 'Saving…' : undefined}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(m.id, 'read')}
                      disabled={busyId === m.id}
                      title={busyId === m.id ? 'Saving…' : undefined}
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
