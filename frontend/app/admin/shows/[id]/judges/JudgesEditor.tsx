'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ShowType {
  id: string;
  code: string;
  name: string;
}

interface JudgeAffiliation {
  id: string;
  code: string;
  name: string;
}

interface Judge {
  id: string;
  show_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  affiliations: JudgeAffiliation[];
  sort_order: number | null;
}

interface Props {
  showId: string;
  initialJudges: Judge[];
  showTypes: ShowType[];
}

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  affiliation_ids: new Set<string>(),
};

function AffiliationCheckboxes({
  showTypes,
  selected,
  onChange,
}: {
  showTypes: ShowType[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (showTypes.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Affiliation</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {showTypes.map((st) => (
          <label key={st.id} className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: '#2c1810' }}>
            <input
              type="checkbox"
              checked={selected.has(st.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(st.id);
                else next.delete(st.id);
                onChange(next);
              }}
            />
            {st.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function JudgesEditor({ showId, initialJudges, showTypes }: Props) {
  const router = useRouter();
  // Filter OPEN — it has no particular affiliation meaning
  const affiliationOptions = showTypes.filter((st) => st.code !== 'OPEN');

  const [judges, setJudges] = useState<Judge[]>(initialJudges);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAddForm() {
    setForm(emptyForm);
    setShowAddForm(false);
    setError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/judges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          affiliation_ids: Array.from(form.affiliation_ids),
          sort_order: judges.length,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? 'Failed to add judge');
      }
      const judge = await res.json();
      setJudges((prev) => [...prev, judge]);
      resetAddForm();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(judge: Judge) {
    setEditingId(judge.id);
    setEditForm({
      first_name: judge.first_name,
      last_name: judge.last_name,
      email: judge.email ?? '',
      phone: judge.phone ?? '',
      affiliation_ids: new Set(judge.affiliations.map((a) => a.id)),
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleSaveEdit(judgeId: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/judges/${judgeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editForm.first_name.trim(),
          last_name: editForm.last_name.trim(),
          email: editForm.email.trim() || null,
          phone: editForm.phone.trim() || null,
          affiliation_ids: Array.from(editForm.affiliation_ids),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? 'Failed to update judge');
      }
      const updated = await res.json();
      setJudges((prev) => prev.map((j) => (j.id === judgeId ? updated : j)));
      setEditingId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(judgeId: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/judges/${judgeId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? 'Failed to delete judge');
      }
      setJudges((prev) => prev.filter((j) => j.id !== judgeId));
      setConfirmDeleteId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      {judges.length === 0 && !showAddForm && (
        <p className="text-sm mb-4" style={{ color: '#8b7355' }}>No judges added yet.</p>
      )}

      {judges.length > 0 && (
        <ul className="space-y-1 mb-4">
          {judges.map((judge) => (
            <li
              key={judge.id}
              className="border-b py-2"
              style={{ borderColor: '#f0e6d2' }}
            >
              {editingId === judge.id ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>First Name</label>
                      <input
                        autoFocus
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: '#d4b896' }}
                        value={editForm.first_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Last Name</label>
                      <input
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: '#d4b896' }}
                        value={editForm.last_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Email</label>
                      <input
                        type="email"
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: '#d4b896' }}
                        value={editForm.email}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Phone</label>
                      <input
                        type="tel"
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: '#d4b896' }}
                        value={editForm.phone}
                        onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                  <AffiliationCheckboxes
                    showTypes={affiliationOptions}
                    selected={editForm.affiliation_ids}
                    onChange={(next) => setEditForm((f) => ({ ...f, affiliation_ids: next }))}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(judge.id)}
                      disabled={saving || !editForm.first_name.trim() || !editForm.last_name.trim()}
                      className="text-xs disabled:opacity-50"
                      style={{ color: '#8b4513' }}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-xs hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
                      {judge.first_name} {judge.last_name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: '#8b7355' }}>
                      {judge.affiliations.map((a) => (
                        <span
                          key={a.id}
                          className="font-mono font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                        >
                          {a.code}
                        </span>
                      ))}
                      {judge.email && <span>{judge.email}</span>}
                      {judge.phone && <span>{judge.phone}</span>}
                    </div>
                  </div>
                  <span className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => startEdit(judge)}
                      disabled={saving}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: '#8b4513' }}
                    >
                      Edit
                    </button>
                    {confirmDeleteId === judge.id ? (
                      <>
                        <span className="text-xs" style={{ color: '#5c3d1e' }}>Delete?</span>
                        <button
                          onClick={() => handleDelete(judge.id)}
                          disabled={saving}
                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          {saving ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs hover:underline"
                          style={{ color: '#8b7355' }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(judge.id)}
                        disabled={saving}
                        className="text-xs text-red-600 hover:underline disabled:opacity-30"
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-sm hover:underline"
          style={{ color: '#8b4513' }}
        >
          + Add judge
        </button>
      )}

      {showAddForm && (
        <form onSubmit={handleAdd} className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>First Name *</label>
              <input
                autoFocus
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: '#d4b896' }}
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Last Name *</label>
              <input
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: '#d4b896' }}
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Email</label>
              <input
                type="email"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: '#d4b896' }}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c3d1e' }}>Phone</label>
              <input
                type="tel"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: '#d4b896' }}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <AffiliationCheckboxes
            showTypes={affiliationOptions}
            selected={form.affiliation_ids}
            onChange={(next) => setForm((f) => ({ ...f, affiliation_ids: next }))}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !form.first_name.trim() || !form.last_name.trim()}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={resetAddForm}
              className="px-3 py-1 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
