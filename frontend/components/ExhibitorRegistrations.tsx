'use client';

import { useState, useEffect } from 'react';

interface ShowType { id: string; code: string; name: string; }
interface Registration {
  id: string;
  show_type_id: string;
  show_type_code: string;
  show_type_name: string;
  member_number: string;
}

interface Document {
  id: string;
  document_type: string;
  expiry_date: string | null;
  show_type_id: string | null;
}

interface Props {
  exhibitorId: string;
  initialRegistrations?: Registration[];
  documents?: Document[];
}

const UNCERTIFIED_CODES = ['OPEN'];

const CARD_LABELS: Record<string, string> = {
  MEMBERSHIP_CARD: 'Membership card',
  AMATEUR_CARD: 'Amateur card',
  YOUTH_CARD: 'Youth card',
};

type CardStatus = 'expired' | 'soon' | 'valid' | 'undated';

function cardStatus(expiry: string | null): CardStatus {
  if (!expiry) return 'undated';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'valid';
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ExhibitorRegistrations({ exhibitorId, initialRegistrations, documents = [] }: Props) {
  const [regs, setRegs] = useState<Registration[]>(initialRegistrations ?? []);
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);
  const [newReg, setNewReg] = useState({ show_type_id: '', member_number: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/show-types').then((r) => r.json()).then(setShowTypes).catch(() => {});
  }, []);

  const usedShowTypeIds = new Set(regs.map((r) => r.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id)
  );

  const handleAdd = async () => {
    if (!newReg.show_type_id || !newReg.member_number.trim()) {
      setError('Select an association and enter a membership ID.');
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/exhibitors/${exhibitorId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_type_id: newReg.show_type_id, member_number: newReg.member_number.trim() }),
    });
    setSaving(false);

    if (res.ok) {
      const created = await res.json();
      setRegs((prev) => [...prev, created]);
      setNewReg({ show_type_id: '', member_number: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save membership ID.');
    }
  };

  const handleDelete = async (regId: string) => {
    setDeletingId(regId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/registrations/${regId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok || res.status === 204) {
      setRegs((prev) => prev.filter((r) => r.id !== regId));
    }
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-3">
      {regs.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No membership IDs on file.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
          {regs.map((reg) => {
            const linkedCards = documents.filter((d) => d.show_type_id === reg.show_type_id && d.document_type in CARD_LABELS);
            return (
            <li key={reg.id} className="flex items-start justify-between py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div>
                  <span className="font-mono text-sm font-semibold mr-2" style={{ color: '#8b4513' }}>
                    {reg.show_type_code}
                  </span>
                  <span className="text-sm" style={{ color: '#2c1810' }}>{reg.member_number}</span>
                  <span className="text-xs ml-2" style={{ color: '#8b7355' }}>({reg.show_type_name})</span>
                </div>
                <div className="text-xs mt-1 space-y-0.5">
                  {linkedCards.length === 0 ? (
                    <p style={{ color: '#a16207' }}>No membership card on file.</p>
                  ) : (
                    linkedCards.map((doc) => {
                      const status = cardStatus(doc.expiry_date);
                      const palette: Record<CardStatus, { color: string; label: string }> = {
                        expired:  { color: '#b91c1c', label: 'Expired' },
                        soon:     { color: '#a16207', label: 'Expiring soon' },
                        valid:    { color: '#166534', label: 'On file' },
                        undated:  { color: '#8b7355', label: 'On file (no expiry)' },
                      };
                      const expiryText = doc.expiry_date ? ` — expires ${formatDate(doc.expiry_date)}` : '';
                      return (
                        <p key={doc.id} style={{ color: palette[status].color }}>
                          {CARD_LABELS[doc.document_type]}: {palette[status].label}{expiryText}
                        </p>
                      );
                    })
                  )}
                </div>
              </div>
              {confirmDeleteId === reg.id ? (
                <span className="flex items-center gap-2 ml-4 shrink-0">
                  <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove?</span>
                  <button
                    onClick={() => handleDelete(reg.id)}
                    disabled={deletingId === reg.id}
                    className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {deletingId === reg.id ? 'Removing…' : 'Yes'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs hover:underline"
                    style={{ color: '#8b7355' }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(reg.id)}
                  className="text-xs text-red-600 hover:text-red-800 ml-4 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {availableShowTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end pt-1">
          <div className="flex-1 min-w-[140px]">
            <select
              value={newReg.show_type_id}
              onChange={(e) => setNewReg((p) => ({ ...p, show_type_id: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Association…</option>
              {availableShowTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <input
              value={newReg.member_number}
              onChange={(e) => setNewReg((p) => ({ ...p, member_number: e.target.value }))}
              placeholder="Membership ID"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {availableShowTypes.length === 0 && regs.length > 0 && (
        <p className="text-xs" style={{ color: '#8b7355' }}>All associations have a membership ID on file.</p>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
