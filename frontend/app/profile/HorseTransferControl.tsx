'use client';

import { useEffect, useState } from 'react';
import ApprovalLinkCallout from '@/components/ApprovalLinkCallout';

type ExhibitorOption = { id: string; full_name: string };

type SentRequest = {
  approval_url: string;
  email_sent: boolean | null;
  approver_name: string;
};

/**
 * Hand a horse to its new owner.
 *
 * The recipient has to accept: ownership carries the paperwork obligations
 * (Coggins, registrations) that gate entries, and nobody should acquire those
 * because somebody else clicked a button. Only exhibitors with an account are
 * offered, since accepting requires signing in.
 */
export default function HorseTransferControl({
  horseId,
  horseName,
  onSent,
}: {
  horseId: string;
  horseName: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ExhibitorOption[]>([]);
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentRequest | null>(null);

  useEffect(() => {
    if (!open || people.length > 0) return;
    fetch('/api/exhibitors/names')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPeople(Array.isArray(rows) ? rows : []))
      .catch(() => setPeople([]));
  }, [open, people.length]);

  const submit = async () => {
    if (!targetId) {
      setError('Choose who is receiving this horse.');
      return;
    }
    setError(null);
    setSending(true);
    const res = await fetch('/api/horse-access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        horse_id: horseId,
        kind: 'transfer',
        to_exhibitor_id: targetId,
        message: note.trim() || null,
      }),
    });
    setSending(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        typeof json?.detail === 'string'
          ? json.detail
          : json?.detail?.message || 'Could not send the transfer request.',
      );
      return;
    }
    setSent({
      approval_url: json.approval_url,
      email_sent: json.email_sent ?? null,
      approver_name: json.approver_name,
    });
    onSent?.();
  };

  if (sent) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-xs" style={{ color: '#5d4a37' }}>
          Transfer request sent for <strong>{horseName}</strong>. You stay the owner until{' '}
          {sent.approver_name} accepts.
        </p>
        <ApprovalLinkCallout
          url={sent.approval_url}
          emailSent={sent.email_sent}
          approverName={sent.approver_name}
        />
        <button
          onClick={() => { setSent(null); setOpen(false); setTargetId(''); setNote(''); }}
          className="text-xs hover:underline"
          style={{ color: '#8b7355' }}
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium hover:underline"
        style={{ color: '#8b4513' }}
        title={`Transfer ownership of ${horseName} to another registered user`}
      >
        Transfer ownership
      </button>
    );
  }

  return (
    <div
      className="mt-3 w-full rounded border p-3 space-y-2"
      style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
    >
      <p className="text-xs" style={{ color: '#5d4a37' }}>
        Transfer <strong>{horseName}</strong> to another registered user. They have to accept before
        anything changes.
      </p>
      <label className="text-xs block" style={{ color: '#8b7355' }}>
        New owner
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        >
          <option value="">Select a registered user…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs block" style={{ color: '#8b7355' }}>
        Note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="e.g. sold at the June sale — congratulations!"
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={submit}
          disabled={sending || !targetId}
          className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
          title={!targetId ? 'Choose who is receiving this horse' : undefined}
        >
          {sending ? 'Sending…' : 'Send transfer request'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs hover:underline"
          style={{ color: '#8b7355' }}
        >
          Cancel
        </button>
      </div>
      {people.length === 0 && (
        <p className="text-xs" style={{ color: '#8b7355' }}>
          Loading registered users…
        </p>
      )}
      {error && <p className="text-xs" style={{ color: '#991b1b' }}>{error}</p>}
    </div>
  );
}
