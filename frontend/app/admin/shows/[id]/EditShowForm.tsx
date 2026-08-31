'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface Show {
  id: string;
  name: string;
  venue: string | null;
  venue_id: string | null;
  show_type_id: string | null;
  show_type_code: string | null;
  start_date: string;
  end_date: string;
  entry_deadline: string | null;
  apha_show_number: string | null;
  apha_zone: number | null;
  show_category_id: string | null;
  offers_clinic: boolean;
  aqha_show_number: string | null;
  aqha_approval_status: string;
  aqha_approval_submitted_at: string | null;
  aqha_approval_notes: string | null;
}

interface ShowType {
  id: string;
  code: string;
  name: string;
}

/** APHA SC-100 / SC-105. `show_type_id` null is a generic row, offered for any
 *  show type. */
interface ShowCategory {
  id: string;
  show_type_id: string | null;
  code: string;
  name: string;
  min_judges: number | null;
  max_judges: number | null;
  judge_limit_basis: string;
  min_days: number | null;
  rule_reference: string | null;
}

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

// Who runs the show is not a detail of the show record — it is the staff roster,
// and it lives in `ShowStaffPanel` alongside the managers, scribes, and gate
// stewards. Step 1 renders both.
export default function EditShowForm({
  show,
  venues,
  showTypes,
  showCategories = [],
}: {
  show: Show;
  venues: Venue[];
  showTypes: ShowType[];
  showCategories?: ShowCategory[];
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: show.name,
    venue_id: show.venue_id ?? '',
    show_type_id: show.show_type_id ?? '',
    start_date: show.start_date,
    end_date: show.end_date,
    entry_deadline: show.entry_deadline ?? '',
    apha_show_number: show.apha_show_number ?? '',
    apha_zone: show.apha_zone === null || show.apha_zone === undefined ? '' : String(show.apha_zone),
    show_category_id: show.show_category_id ?? '',
    offers_clinic: show.offers_clinic ?? false,
    aqha_show_number: show.aqha_show_number ?? '',
    aqha_approval_status: show.aqha_approval_status ?? 'NOT_SUBMITTED',
    aqha_approval_submitted_at: show.aqha_approval_submitted_at ?? '',
    aqha_approval_notes: show.aqha_approval_notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const selectedShowType = showTypes.find((t) => t.id === form.show_type_id);

  // A category belongs to one show type, plus the generic rows that belong to
  // none. Filtered here rather than refetched, because the show-type picker sits
  // directly above and the list has to change the moment it does.
  const categoriesForType = showCategories.filter(
    (c) => c.show_type_id === null || c.show_type_id === form.show_type_id,
  );
  const selectedCategory = categoriesForType.find((c) => c.id === form.show_category_id);

  const handleSave = async () => {
    if (!form.name || !form.start_date || !form.end_date || !form.show_type_id) {
      setError('Name, show type, start date, and end date are required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);

    const res = await fetch(`/api/shows/${show.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        venue_id: form.venue_id || null,
        show_type_id: form.show_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        entry_deadline: form.entry_deadline || null,
        apha_show_number: form.apha_show_number || null,
        apha_zone: form.apha_zone ? Number(form.apha_zone) : null,
        show_category_id: form.show_category_id || null,
        offers_clinic: form.offers_clinic,
        aqha_show_number: form.aqha_show_number || null,
        aqha_approval_status: form.aqha_approval_status,
        aqha_approval_submitted_at: form.aqha_approval_submitted_at || null,
        aqha_approval_notes: form.aqha_approval_notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSuccess('Show details saved.');
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.detail || 'Failed to update show.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/shows/${show.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setConfirmDelete(false);
      setError('Failed to delete show.');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {success}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Show details
        </h2>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
          placeholder="Show name *"
        />
        <select
          name="show_type_id"
          value={form.show_type_id}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">Select show type *</option>
          {showTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} — {t.name}
            </option>
          ))}
        </select>
        <select
          name="venue_id"
          value={form.venue_id}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          style={{ borderColor: COLORS.border }}
        >
          <option value="">Select a venue (optional)</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.city ? `, ${v.city}` : ''}
              {v.state ? `, ${v.state}` : ''}
            </option>
          ))}
        </select>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Start date *
            </span>
            <input
              name="start_date"
              type="date"
              value={form.start_date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              End date *
            </span>
            <input
              name="end_date"
              type="date"
              value={form.end_date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Entry deadline
          </span>
          <input
            name="entry_deadline"
            type="date"
            value={form.entry_deadline}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: COLORS.border }}
          />
          <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
            The day entries close. Recorded, not enforced — it does not close
            self-registration and it does not add the post-entry fee. An APHA show
            counts its approval-application deadline back from this date, or from
            the first day of the show when it is left blank.
          </span>
        </label>

        {categoriesForType.length > 0 && (
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Kind of show
            </span>
            <select
              name="show_category_id"
              value={form.show_category_id}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">Not stated</option>
              {categoriesForType.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.rule_reference ? ` (${c.rule_reference})` : ''}
                </option>
              ))}
            </select>
            {selectedCategory && (
              <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
                {selectedCategory.min_judges === selectedCategory.max_judges
                  ? `${selectedCategory.max_judges} judge${selectedCategory.max_judges === 1 ? '' : 's'}`
                  : `${selectedCategory.min_judges ?? 1}\u2013${selectedCategory.max_judges} judges`}
                {selectedCategory.judge_limit_basis === 'in_arena'
                  ? ' in the arena at any given time'
                  : ''}
                {selectedCategory.min_days
                  ? `, over ${selectedCategory.min_days} or more consecutive days`
                  : ''}
                .
              </span>
            )}
          </label>
        )}

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={form.offers_clinic}
            onChange={(e) => setForm((prev) => ({ ...prev, offers_clinic: e.target.checked }))}
            className="mt-1"
          />
          <span className="text-sm" style={{ color: COLORS.text }}>
            A clinic runs alongside this show
            <span className="block text-xs" style={{ color: COLORS.muted }}>
              For an APHA two-judge show this lifts the SC-095 minimum class
              requirements, pending APHA approval. The clinician must be approved by
              APHA, and the show may not run in conjunction with an approved
              Paint-O-Rama — neither of which the app can check.
            </span>
          </span>
        </label>

        {selectedShowType?.code === 'APHA' && (
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              APHA Show Number
            </span>
            <input
              name="apha_show_number"
              value={form.apha_show_number}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
              placeholder="e.g. 2024-TX-0042"
            />
          </label>
        )}
        {selectedShowType?.code === 'APHA' && (
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              APHA Zone
            </span>
            <select
              name="apha_zone"
              value={form.apha_zone}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">Not stated</option>
              {Array.from({ length: 14 }, (_, i) => i + 1).map((z) => (
                <option key={z} value={z}>Zone {z}</option>
              ))}
            </select>
            <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
              Zones 12, 13 and 14 change how equitation and horsemanship are run —
              each exhibitor worked individually from the gate, no rail work. The
              gate screen shows the rule on those classes.
            </span>
          </label>
        )}
        {selectedShowType?.code === 'AQHA' && (
          <div
            className="border rounded p-3 space-y-3"
            style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}
          >
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                AQHA Show Number
              </span>
              <input
                name="aqha_show_number"
                value={form.aqha_show_number}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                placeholder="Assigned by AQHA after approval"
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                  AQHA Approval Status
                </span>
                <select
                  name="aqha_approval_status"
                  value={form.aqha_approval_status}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                >
                  <option value="NOT_SUBMITTED">Not submitted</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="APPROVED">Approved</option>
                  <option value="CHANGES_REQUIRED">Changes required</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                  Submitted to AQHA
                </span>
                <input
                  name="aqha_approval_submitted_at"
                  type="date"
                  value={form.aqha_approval_submitted_at}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                  style={{ borderColor: COLORS.border }}
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                AQHA Approval Notes
              </span>
              <input
                name="aqha_approval_notes"
                value={form.aqha_approval_notes}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                style={{ borderColor: COLORS.border }}
                placeholder="Class schedule submitted, pending correction, etc."
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            {saving ? 'Saving…' : 'Save show details'}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: COLORS.warn }}>
                Delete show and all its data?
              </span>
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
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Delete Show
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
