'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { APHA_DIVISIONS, RELATIONSHIP_OPTIONS, RELATIONSHIP_REQUIRED_DIVISIONS } from '@/lib/apha';

interface Entry {
  id: string;
  class_id: string;
  exhibitor_id: string;
  horse_id: string | null;
  back_number: number | null;
  status: string;
  apha_division: string | null;
  relationship_to_owner: string | null;
  is_disqualified: boolean;
  horse_name?: string;
  horse?: { name: string };
  exhibitor_name?: string;
  exhibitor?: { full_name: string };
}

interface ClassGroup {
  cls: { id: string; class_number?: string; class_name?: string; name?: string };
  entries: Entry[];
}

interface Props {
  showId: string;
  entriesByClass: ClassGroup[];
  isAphaShow: boolean;
}

function EntryRow({ entry, showId, isAphaShow, onSaved, onDeleted }: {
  entry: Entry;
  showId: string;
  isAphaShow: boolean;
  onSaved: (updated: Entry) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    back_number: entry.back_number != null ? String(entry.back_number) : '',
    apha_division: entry.apha_division ?? '',
    relationship_to_owner: entry.relationship_to_owner ?? '',
    is_disqualified: entry.is_disqualified,
  });

  const horseName = entry.horse_name ?? entry.horse?.name ?? '(unknown horse)';
  const exhibitorName = entry.exhibitor_name ?? entry.exhibitor?.full_name ?? '(unknown exhibitor)';
  const showRelationship = isAphaShow && RELATIONSHIP_REQUIRED_DIVISIONS.has(form.apha_division);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId,
        classId: entry.class_id,
        back_number: form.back_number ? parseInt(form.back_number) : null,
        apha_division: isAphaShow && form.apha_division ? form.apha_division : null,
        relationship_to_owner: isAphaShow && form.relationship_to_owner ? form.relationship_to_owner : null,
        is_disqualified: form.is_disqualified,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const updated = await res.json();
      onSaved(updated);
      setEditing(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(
      `/api/entries/${entry.id}?showId=${showId}&classId=${entry.class_id}`,
      { method: 'DELETE' }
    );
    setDeleting(false);
    if (res.ok || res.status === 204) {
      onDeleted(entry.id);
    } else {
      setConfirmDelete(false);
      setError('Failed to delete entry.');
    }
  };

  if (editing) {
    return (
      <li className="rounded border p-3 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
        <div className="text-sm font-medium" style={{ color: '#2c1810' }}>
          {horseName} — {exhibitorName}
        </div>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: '#5c3d1e' }}>Back #</label>
            <input
              type="number"
              value={form.back_number}
              onChange={e => setForm(f => ({ ...f, back_number: e.target.value }))}
              className="w-24 border rounded px-2 py-1 text-sm"
              style={{ borderColor: '#d4b896' }}
              placeholder="—"
            />
          </div>
          {isAphaShow && (
            <>
              <div>
                <label className="block text-xs mb-1" style={{ color: '#5c3d1e' }}>APHA Division</label>
                <select
                  value={form.apha_division}
                  onChange={e => setForm(f => ({ ...f, apha_division: e.target.value }))}
                  className="border rounded px-2 py-1 text-sm"
                  style={{ borderColor: '#d4b896' }}
                >
                  <option value="">— Not specified —</option>
                  {APHA_DIVISIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              {showRelationship && (
                <div>
                  <label className="block text-xs mb-1" style={{ color: '#5c3d1e' }}>Relationship to Owner</label>
                  <select
                    value={form.relationship_to_owner}
                    onChange={e => setForm(f => ({ ...f, relationship_to_owner: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm"
                    style={{ borderColor: '#d4b896' }}
                  >
                    <option value="">— Not specified —</option>
                    {RELATIONSHIP_OPTIONS.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: '#5c3d1e' }}>
                  <input
                    type="checkbox"
                    checked={form.is_disqualified}
                    onChange={e => setForm(f => ({ ...f, is_disqualified: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  Disqualified (DQ)
                </label>
              </div>
            </>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 rounded text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: '#8b4513' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setError(null); }}
            className="px-3 py-1 rounded text-xs border"
            style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between text-sm py-1 gap-2">
      <span style={{ color: '#2c1810' }}>
        {entry.back_number != null && (
          <span className="font-mono mr-2" style={{ color: '#8b4513' }}>#{entry.back_number}</span>
        )}
        {horseName}
        <span style={{ color: '#8b7355' }}> — </span>
        {exhibitorName}
        {entry.is_disqualified && (
          <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">DQ</span>
        )}
        {entry.apha_division && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#e8d5b7', color: '#5c3d1e' }}>
            {entry.apha_division.replace(/_/g, ' ')}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          onClick={() => setEditing(true)}
          className="text-xs hover:underline"
          style={{ color: '#8b4513' }}
        >
          Edit
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-xs hover:underline text-red-600"
        >
          Remove
        </button>
      </span>

      {confirmDelete && (
        <ConfirmDialog
          title="Remove Entry"
          message={`Remove ${exhibitorName}'s entry for ${horseName}? This cannot be undone.`}
          confirmLabel="Yes, remove"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </li>
  );
}

export default function EntryListSection({ showId, entriesByClass, isAphaShow }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<ClassGroup[]>(entriesByClass);

  const handleSaved = (classId: string, updated: Entry) => {
    setGroups(prev => prev.map(g =>
      g.cls.id !== classId ? g : {
        ...g,
        entries: g.entries.map(e => e.id === updated.id ? updated : e),
      }
    ));
    router.refresh();
  };

  const handleDeleted = (classId: string, entryId: string) => {
    setGroups(prev => prev.map(g =>
      g.cls.id !== classId ? g : {
        ...g,
        entries: g.entries.filter(e => e.id !== entryId),
      }
    ));
    router.refresh();
  };

  if (groups.length === 0) {
    return <p style={{ color: '#8b7355' }}>No classes yet. Add a class first.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map(({ cls, entries }) => (
        <div
          key={cls.id}
          className="p-4 rounded-lg border"
          style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold" style={{ color: '#2c1810' }}>
              {cls.class_number != null ? `${cls.class_number} — ` : ''}{cls.class_name ?? cls.name ?? 'Class'}
              <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
                ({entries.length})
              </span>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No entries yet.</p>
          ) : (
            <ul className="space-y-1">
              {entries.map(entry => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  showId={showId}
                  isAphaShow={isAphaShow}
                  onSaved={updated => handleSaved(cls.id, updated)}
                  onDeleted={id => handleDeleted(cls.id, id)}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
