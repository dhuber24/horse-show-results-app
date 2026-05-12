'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface ShowType {
  id: string;
  code: string;
  name: string;
}

const UNCERTIFIED_CODES = ['OPEN'];

export default function CreateShowForm({ venues, showTypes }: { venues: Venue[]; showTypes: ShowType[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    venue_id: '',
    show_type_id: '',
    start_date: '',
    end_date: '',
    apha_show_number: '',
    aqha_show_number: '',
    aqha_approval_status: 'NOT_SUBMITTED',
    aqha_approval_submitted_at: '',
    aqha_approval_notes: '',
  });
  const [affiliationIds, setAffiliationIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const toggleAffiliation = (id: string) => {
    setAffiliationIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const affiliationOptions = showTypes.filter(
    (t) => !UNCERTIFIED_CODES.includes(t.code) && t.id !== form.show_type_id,
  );
  const selectedShowType = showTypes.find((t) => t.id === form.show_type_id);

  const handleSubmit = async () => {
    if (!form.name || !form.start_date || !form.end_date || !form.show_type_id) {
      setError('Name, show type, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch('/api/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        venue_id: form.venue_id || null,
        show_type_id: form.show_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        apha_show_number: form.apha_show_number || null,
        aqha_show_number: form.aqha_show_number || null,
        aqha_approval_status: form.aqha_approval_status,
        aqha_approval_submitted_at: form.aqha_approval_submitted_at || null,
        aqha_approval_notes: form.aqha_approval_notes || null,
      }),
    });
    if (!res.ok) {
      setSaving(false);
      setError('Failed to create show.');
      return;
    }
    const show = await res.json();

    if (affiliationIds.size > 0) {
      await fetch(`/api/shows/${show.id}/affiliations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_type_ids: Array.from(affiliationIds) }),
      });
    }

    setSaving(false);
    router.push(`/admin/shows/${show.id}`);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input name="name" placeholder="Show name *" value={form.name} onChange={handleChange}
        className="w-full border rounded px-3 py-2" />
      <select name="show_type_id" value={form.show_type_id} onChange={handleChange}
        className="w-full border rounded px-3 py-2">
        <option value="">Select show type *</option>
        {showTypes.map((t) => (
          <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
        ))}
      </select>
      <select name="venue_id" value={form.venue_id} onChange={handleChange}
        className="w-full border rounded px-3 py-2">
        <option value="">Select a venue (optional)</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}{v.city ? `, ${v.city}` : ''}{v.state ? `, ${v.state}` : ''}
          </option>
        ))}
      </select>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm text-gray-500">Start date *</label>
          <input name="start_date" type="date" value={form.start_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2" />
        </div>
        <div className="flex-1">
          <label className="text-sm text-gray-500">End date *</label>
          <input name="end_date" type="date" value={form.end_date} onChange={handleChange}
            className="w-full border rounded px-3 py-2" />
        </div>
      </div>
      {selectedShowType?.code === 'APHA' && (
        <div>
          <label className="text-sm text-gray-500">APHA Show Number</label>
          <input
            name="apha_show_number"
            value={form.apha_show_number}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            placeholder="e.g. 2024-TX-0042"
          />
        </div>
      )}
      {selectedShowType?.code === 'AQHA' && (
        <div className="border rounded p-3 space-y-3" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <div>
            <label className="text-sm text-gray-500">AQHA Show Number</label>
            <input
              name="aqha_show_number"
              value={form.aqha_show_number}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              placeholder="Assigned by AQHA after approval"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-500">AQHA Approval Status</label>
              <select name="aqha_approval_status" value={form.aqha_approval_status} onChange={handleChange}
                className="w-full border rounded px-3 py-2">
                <option value="NOT_SUBMITTED">Not submitted</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED">Approved</option>
                <option value="CHANGES_REQUIRED">Changes required</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-500">Submitted to AQHA</label>
              <input name="aqha_approval_submitted_at" type="date" value={form.aqha_approval_submitted_at} onChange={handleChange}
                className="w-full border rounded px-3 py-2" />
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-500">AQHA Approval Notes</label>
            <input
              name="aqha_approval_notes"
              value={form.aqha_approval_notes}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              placeholder="Class schedule submitted, pending correction, etc."
            />
          </div>
        </div>
      )}
      {form.show_type_id && affiliationOptions.length > 0 && (
        <div className="border rounded p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
          <label className="text-sm font-medium" style={{ color: '#2c1810' }}>
            Secondary affiliations offered in some classes
          </label>
          <p className="text-xs" style={{ color: '#8b7355' }}>
            Check any associations whose points will be available in select classes at this show.
          </p>
          <div className="flex flex-wrap gap-3">
            {affiliationOptions.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={affiliationIds.has(t.id)}
                  onChange={() => toggleAffiliation(t.id)}
                  className="rounded"
                />
                <span className="font-mono font-semibold" style={{ color: '#8b4513' }}>{t.code}</span>
                <span style={{ color: '#5c3d1e' }}>{t.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Creating…' : 'Create Show'}
      </button>
    </div>
  );
}
