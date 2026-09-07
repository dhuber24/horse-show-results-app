'use client';

import { useEffect, useState } from 'react';

interface Association { id: string; code: string; name: string; }

interface Affiliation {
  id: string;
  association_id: string;
  association_code: string;
  association_name: string;
  member_number: string;
  status: 'professional' | 'non_pro' | 'general';
  expires_at: string | null;
}

const UNCERTIFIED_CODES = ['OPEN'];

const STATUS_LABEL: Record<Affiliation['status'], string> = {
  professional: 'Professional',
  non_pro: 'Non Pro',
  general: 'Member',
};

type ExpiryStatus = 'expired' | 'soon' | 'valid' | 'undated';

function expiryStatus(expiry: string | null): ExpiryStatus {
  if (!expiry) return 'undated';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'valid';
}

const EXPIRY_STYLE: Record<ExpiryStatus, { color: string; label: string }> = {
  expired: { color: 'var(--error)', label: 'Expired' },
  soon: { color: 'var(--warning)', label: 'Expiring soon' },
  valid: { color: 'var(--success-strong)', label: 'Current' },
  undated: { color: 'var(--muted)', label: 'No expiry on file' },
};

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  initialAffiliations: Affiliation[];
}

export default function TrainerAffiliationsPanel({ initialAffiliations }: Props) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>(initialAffiliations);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [form, setForm] = useState<{
    association_id: string;
    member_number: string;
    status: Affiliation['status'];
    expires_at: string;
  }>({ association_id: '', member_number: '', status: 'general', expires_at: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    member_number: string;
    status: Affiliation['status'];
    expires_at: string;
  }>({ member_number: '', status: 'general', expires_at: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  const usedAssociationIds = new Set(affiliations.map((a) => a.association_id));
  const available = associations.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedAssociationIds.has(st.id)
  );

  const handleAdd = async () => {
    if (!form.association_id || !form.member_number.trim()) {
      setError('Pick an association and enter a member number.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/trainers/me/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        association_id: form.association_id,
        member_number: form.member_number.trim(),
        status: form.status,
        expires_at: form.expires_at || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to add affiliation.');
      return;
    }
    const created: Affiliation = await res.json();
    setAffiliations((prev) => [...prev, created]);
    setForm({ association_id: '', member_number: '', status: 'general', expires_at: '' });
  };

  const startEdit = (a: Affiliation) => {
    setEditingId(a.id);
    setEditForm({
      member_number: a.member_number,
      status: a.status,
      expires_at: a.expires_at ?? '',
    });
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setError(null);
    const original = affiliations.find((a) => a.id === editingId);
    const body: Record<string, unknown> = {
      member_number: editForm.member_number.trim(),
      status: editForm.status,
    };
    if (!editForm.expires_at) {
      if (original?.expires_at) body.clear_expires_at = true;
    } else {
      body.expires_at = editForm.expires_at;
    }
    const res = await fetch(`/api/trainers/me/registrations/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to update affiliation.');
      return;
    }
    const updated: Affiliation = await res.json();
    setAffiliations((prev) => prev.map((a) => (a.id === editingId ? updated : a)));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/trainers/me/registrations/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setAffiliations((prev) => prev.filter((a) => a.id !== id));
      setConfirmDeleteId(null);
      return;
    }
    const err = await res.json().catch(() => ({}));
    setError(err.detail || 'Failed to delete affiliation.');
  };

  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

  return (
    <div className="space-y-5">
      <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>Add Affiliation</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
            Association
            <select
              value={form.association_id}
              onChange={(e) => setForm((p) => ({ ...p, association_id: e.target.value }))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
              style={inputStyle}
            >
              <option value="">- Choose -</option>
              {available.map((st) => (
                <option key={st.id} value={st.id}>{st.name} ({st.code})</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
            Member Number
            <input
              value={form.member_number}
              onChange={(e) => setForm((p) => ({ ...p, member_number: e.target.value }))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
              style={inputStyle}
            />
          </label>
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Affiliation['status'] }))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
              style={inputStyle}
            >
              <option value="general">Member (general)</option>
              <option value="professional">Professional / Pro Horseman</option>
              <option value="non_pro">Non Pro</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
            Expires (optional)
            <input
              type="date"
              value={form.expires_at}
              onChange={(e) => setForm((p) => ({ ...p, expires_at: e.target.value }))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
              style={inputStyle}
            />
          </label>
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !form.association_id || !form.member_number.trim()}
          title={!form.association_id ? 'Choose an association first' : !form.member_number.trim() ? 'Enter your member number' : undefined}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {saving ? 'Adding...' : 'Add Affiliation'}
        </button>
      </section>

      {affiliations.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No affiliations on file yet.</p>
      ) : (
        <ul className="space-y-2">
          {affiliations.map((a) => {
            const status = expiryStatus(a.expires_at);
            const style = EXPIRY_STYLE[status];
            return (
              <li key={a.id} className="border rounded p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                {editingId === a.id ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{a.association_name} ({a.association_code})</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
                        Member Number
                        <input
                          value={editForm.member_number}
                          onChange={(e) => setEditForm((p) => ({ ...p, member_number: e.target.value }))}
                          className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
                          style={inputStyle}
                        />
                      </label>
                      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
                        Status
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value as Affiliation['status'] }))}
                          className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
                          style={inputStyle}
                        >
                          <option value="general">Member (general)</option>
                          <option value="professional">Professional / Pro Horseman</option>
                          <option value="non_pro">Non Pro</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-deep)' }}>
                        Expires
                        <input
                          type="date"
                          value={editForm.expires_at}
                          onChange={(e) => setEditForm((p) => ({ ...p, expires_at: e.target.value }))}
                          className="mt-1 w-full border rounded px-3 py-2 text-sm normal-case font-normal"
                          style={inputStyle}
                        />
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={handleSaveEdit} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>Save</button>
                      <button onClick={() => setEditingId(null)} className="text-sm" style={{ color: 'var(--muted)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>{a.association_name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
                          {a.association_code}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}>
                          {STATUS_LABEL[a.status]}
                        </span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                        Member #{a.member_number}
                      </p>
                      <p className="text-xs" style={{ color: style.color }}>
                        {style.label}{a.expires_at ? ` · ${formatDate(a.expires_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => startEdit(a)} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>Edit</button>
                      {confirmDeleteId === a.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>Remove?</span>
                          <button onClick={() => handleDelete(a.id)} className="text-xs text-red-600 hover:underline">Yes</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(a.id)} className="text-sm text-red-600">Remove</button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
