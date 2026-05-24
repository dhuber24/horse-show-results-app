'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

interface ShowType { id: string; code: string; name: string; }
interface Ring { id: string; name: string; }
interface Division { id: string; name: string; }
interface Section { id: string; name: string; division_ids?: string[]; }
interface ClassAssociation {
  id: string;
  class_id: string;
  show_type_id: string;
  show_type_code: string | null;
  show_type_name: string | null;
  association_class_code: string | null;
}
interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  score_type: 'placement' | 'pattern' | 'time';
  entry_fee_cents: number;
  ring_id: string | null;
  division_id: string | null;
  section_id: string | null;
  associations: ClassAssociation[];
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const UNCERTIFIED_CODES = ['OPEN'];

const SCORE_TYPE_LABELS: Record<ClassItem['score_type'], string> = {
  placement: 'Placement',
  pattern: 'Pattern score',
  time: 'Timed',
};

export default function EditClassCard({
  cls, position, showId, showStartDate, showEndDate, showTypes, rings, divisions, sections,
}: {
  cls: ClassItem;
  position: number;
  showId: string;
  showStartDate: string;
  showEndDate: string;
  showTypes: ShowType[];
  rings: Ring[];
  divisions: Division[];
  sections: Section[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    class_name: cls.class_name,
    class_date: cls.class_date,
    ring_id: cls.ring_id ?? '',
    division_id: cls.division_id ?? '',
    section_id: cls.section_id ?? '',
    status: cls.status,
    score_type: cls.score_type,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [associations, setAssociations] = useState<ClassAssociation[]>(cls.associations ?? []);
  const [newAssoc, setNewAssoc] = useState({ show_type_id: '', association_class_code: '' });
  const [addingAssoc, setAddingAssoc] = useState(false);
  const [assocError, setAssocError] = useState<string | null>(null);
  const [confirmDeleteAssocId, setConfirmDeleteAssocId] = useState<string | null>(null);

  const isDirty =
    form.class_name !== cls.class_name ||
    form.class_date !== cls.class_date ||
    (form.ring_id || null) !== cls.ring_id ||
    (form.division_id || null) !== cls.division_id ||
    (form.section_id || null) !== cls.section_id ||
    form.status !== cls.status ||
    form.score_type !== cls.score_type;

  const sectionsForDivision = useMemo(
    () =>
      form.division_id
        ? sections.filter((s) => (s.division_ids ?? []).includes(form.division_id))
        : [],
    [sections, form.division_id],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => {
      if (name === 'division_id') {
        // If the previously-selected section isn't valid for the new division,
        // clear it so the composite FK doesn't reject the save.
        const stillValid = value
          ? sections.find((s) => s.id === prev.section_id)?.division_ids?.includes(value)
          : false;
        return { ...prev, division_id: value, section_id: stillValid ? prev.section_id : '' };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleSave = async () => {
    if (!form.class_name || !form.class_date) {
      setError('Class name and date are required.');
      return;
    }
    if (!form.division_id) {
      setError('A division is required.');
      return;
    }
    if (!form.section_id) {
      setError('A section is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/classes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId,
        classId: cls.id,
        class_name: form.class_name,
        class_date: form.class_date,
        ring_id: form.ring_id || null,
        division_id: form.division_id,
        section_id: form.section_id,
        status: form.status,
        score_type: form.score_type,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to update class.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch('/api/classes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId: cls.id }),
    });
    setDeleting(false);
    if (res.ok) {
      router.refresh();
    } else {
      setConfirmDelete(false);
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete class.');
    }
  };

  const handleMinimize = () => {
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
  };

  const handleDiscard = () => {
    setForm({
      class_name: cls.class_name,
      class_date: cls.class_date,
      ring_id: cls.ring_id ?? '',
      division_id: cls.division_id ?? '',
      section_id: cls.section_id ?? '',
      status: cls.status,
      score_type: cls.score_type,
    });
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
  };

  const handleAddAssoc = async () => {
    if (!newAssoc.show_type_id) {
      setAssocError('Select an association.');
      return;
    }
    setAddingAssoc(true);
    setAssocError(null);
    const code = newAssoc.association_class_code.trim();
    const res = await fetch(`/api/classes/${cls.id}/associations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId,
        show_type_id: newAssoc.show_type_id,
        association_class_code: code ? code : null,
      }),
    });
    setAddingAssoc(false);
    if (res.ok) {
      const created = await res.json();
      setAssociations((prev) => [...prev, created]);
      setNewAssoc({ show_type_id: '', association_class_code: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setAssocError(err.detail ?? 'Failed to add association.');
    }
  };

  const handleDeleteAssoc = async (assocId: string) => {
    const res = await fetch(`/api/classes/${cls.id}/associations/${assocId}?showId=${showId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setAssociations((prev) => prev.filter((a) => a.id !== assocId));
    } else {
      const err = await res.json().catch(() => ({}));
      setAssocError(err.detail ?? 'Failed to remove association.');
    }
  };

  const usedShowTypeIds = new Set(associations.map((a) => a.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id),
  );

  const ringName = cls.ring_id ? rings.find((r) => r.id === cls.ring_id)?.name : null;
  const divisionName = cls.division_id ? divisions.find((d) => d.id === cls.division_id)?.name : null;
  const sectionName = cls.section_id ? sections.find((s) => s.id === cls.section_id)?.name : null;

  if (!editing) {
    return (
      <div
        className="p-3 rounded-lg border flex justify-between items-center cursor-pointer hover:bg-gray-50 transition"
        style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
        onClick={() => setEditing(true)}
      >
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono font-semibold mr-2 px-1.5 py-0.5 rounded"
            style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}>
            #{position}
          </span>
          <span className="font-medium" style={{ color: '#2c1810' }}>{cls.class_name}</span>
          <span className="text-sm ml-2" style={{ color: '#8b7355' }}>{cls.class_date}</span>
          {ringName && (
            <span className="text-xs ml-2" style={{ color: '#8b7355' }}>· {ringName}</span>
          )}
          {divisionName && (
            <span className="text-xs ml-2" style={{ color: '#8b7355' }}>· {divisionName}</span>
          )}
          {sectionName && sectionName !== 'Unassigned' && (
            <span className="text-xs ml-1" style={{ color: '#8b7355' }}>/ {sectionName}</span>
          )}
          {associations.map((a) => (
            <span
              key={a.id}
              className="text-xs ml-2 font-mono px-1 rounded"
              style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
              title={a.show_type_name ?? undefined}
            >
              {a.show_type_code}{a.association_class_code ? `:${a.association_class_code}` : ''}
            </span>
          ))}
          {cls.entry_fee_cents > 0 && (
            <span
              className="text-xs ml-2 px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: '#f0e8d8', color: '#5d4a37' }}
              title="Entry fee shown to exhibitors on the registration screen."
            >
              {formatMoney(cls.entry_fee_cents)}
            </span>
          )}
          {cls.score_type !== 'placement' && (
            <span
              className="text-xs ml-2 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: '#dcebd5', color: '#3f6b2f' }}
              title="Placings are derived from raw scores entered by the scorekeeper."
            >
              {SCORE_TYPE_LABELS[cls.score_type]}
            </span>
          )}
          {isDirty && (
            <span className="text-xs ml-2 italic" style={{ color: '#b45309' }}>· unsaved changes</span>
          )}
        </div>
        <span className="text-xs px-2 py-1 rounded-full"
          style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
          {cls.status}
        </span>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex gap-3 items-center">
        <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded shrink-0"
          style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}>
          #{position}
        </span>
        <input name="class_name" value={form.class_name} onChange={handleChange}
          placeholder="Class name" className="flex-1 border rounded px-3 py-2" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Class date</label>
          <select name="class_date" value={form.class_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            {showDates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">Status</label>
          <select name="status" value={form.status} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">Scoring</label>
          <select name="score_type" value={form.score_type} onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            title="Placement: judges rank entries (rail, halter). Pattern score: judges score numerically (showmanship, horsemanship, trail, reining). Timed: clocked event (barrels, poles, stakes).">
            <option value="placement">Placement</option>
            <option value="pattern">Pattern score</option>
            <option value="time">Timed</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3">
        {rings.length > 0 && (
          <div className="flex-1">
            <label className="text-sm text-gray-500">Ring</label>
            <select name="ring_id" value={form.ring_id} onChange={handleChange}
              className="w-full border rounded px-3 py-2">
              <option value="">None</option>
              {rings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex-1">
          <label className="text-sm text-gray-500">Division *</label>
          <select name="division_id" value={form.division_id} onChange={handleChange}
            className="w-full border rounded px-3 py-2">
            <option value="">Select…</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">Section *</label>
          <select
            name="section_id"
            value={form.section_id}
            onChange={handleChange}
            disabled={!form.division_id}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            title={!form.division_id ? 'Pick a division first' : undefined}
          >
            <option value="">{form.division_id ? 'Select…' : 'Pick a division first'}</option>
            {sectionsForDivision.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {form.division_id && sectionsForDivision.length === 0 && (
            <p className="text-xs mt-1" style={{ color: '#b45309' }}>
              No sections in this division — assign one on the Setup page.
            </p>
          )}
        </div>
      </div>

      {(associations.length > 0 || availableShowTypes.length > 0) && (
      <div className="border-t pt-3 space-y-2" style={{ borderColor: '#e8d5b7' }}>
        <label className="text-sm font-medium" style={{ color: '#2c1810' }}>Association class codes</label>
        {associations.length > 0 ? (
          <ul className="space-y-1">
            {associations.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-2 rounded border text-sm"
                style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div>
                  <span className="font-mono font-semibold" style={{ color: '#8b4513' }}>{a.show_type_code}</span>
                  {a.association_class_code ? (
                    <span className="ml-2" style={{ color: '#2c1810' }}>{a.association_class_code}</span>
                  ) : (
                    <span className="ml-2 italic text-xs" style={{ color: '#8b7355' }}>no code</span>
                  )}
                </div>
                {confirmDeleteAssocId === a.id ? (
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove?</span>
                    <button
                      onClick={() => { handleDeleteAssoc(a.id); setConfirmDeleteAssocId(null); }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Yes, remove
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAssocId(null)}
                      className="text-xs hover:underline" style={{ color: '#8b7355' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteAssocId(a.id)}
                    className="text-xs text-red-600 hover:text-red-800 ml-3 shrink-0"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs" style={{ color: '#8b7355' }}>No association codes set.</p>
        )}
        {isDirty ? (
          <p className="text-xs italic" style={{ color: '#b45309' }}>
            Save class changes before adding association codes.
          </p>
        ) : availableShowTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end pt-1">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association</label>
              <select
                value={newAssoc.show_type_id}
                onChange={(e) => setNewAssoc((p) => ({ ...p, show_type_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {availableShowTypes.map((st) => (
                  <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>
                Class code <span className="italic">(optional)</span>
              </label>
              <input
                value={newAssoc.association_class_code}
                onChange={(e) => setNewAssoc((p) => ({ ...p, association_class_code: e.target.value }))}
                placeholder="e.g. WP01, 184/684"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleAddAssoc}
              disabled={addingAssoc}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {addingAssoc ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
        {assocError && <p className="text-red-600 text-xs">{assocError}</p>}
      </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex gap-2 items-center">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            title={!isDirty ? 'No changes to save' : saving ? 'Saving, please wait…' : undefined}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleMinimize}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Minimize
          </button>
          {isDirty && (
            <button
              onClick={handleDiscard}
              className="text-sm hover:underline"
              style={{ color: '#b45309' }}
            >
              Discard changes
            </button>
          )}
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#5c3d1e' }}>Delete class and all entries?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-xs hover:underline" style={{ color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
