'use client';

import { useEffect, useMemo, useState } from 'react';
import { COLORS } from './types';

interface ExhibitorName {
  id: string;
  full_name: string;
}

/**
 * Putting a walk-up on this show's roster.
 *
 * Only exhibitors with a linked user account are offered, which is what
 * `/exhibitors/names` returns and what the old Add Entry picker filtered for —
 * accountless records are orphaned test data, and creating an `EXHIBITOR` user
 * is an admin job with its own screen.
 *
 * Adding somebody here creates the `show_entries` shell row and nothing else:
 * no back number, no entries. That row is what a back number and a side pot
 * entry hang off, so it has to exist before the desk can do either.
 */
export default function AddExhibitorForm({
  showId,
  onRosterIds,
  onAdded,
  onCancel,
}: {
  showId: string;
  /** Who is already at this show, so the picker does not offer them again. */
  onRosterIds: Set<string>;
  onAdded: (exhibitorId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [people, setPeople] = useState<ExhibitorName[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/exhibitors/names')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load the exhibitor list.'))
      .finally(() => setLoading(false));
  }, []);

  const matches = useMemo(() => {
    const available = people.filter((p) => !onRosterIds.has(p.id));
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 12);
    return available.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 12);
  }, [people, onRosterIds, query]);

  const add = async (exhibitorId: string) => {
    setSaving(exhibitorId);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/desk/exhibitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exhibitor_id: exhibitorId }),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body?.detail === 'string' ? body.detail : 'Could not add them to this show.');
      return;
    }
    await onAdded(exhibitorId);
  };

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: COLORS.border, backgroundColor: '#fffdf9' }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Add someone to this show</h3>
        <button type="button" onClick={onCancel} className="text-xs hover:underline" style={{ color: COLORS.muted }}>
          Cancel
        </button>
      </div>

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={loading ? 'Loading exhibitors…' : 'Type a name…'}
        disabled={loading}
        className="w-full border rounded px-3 py-2 text-sm disabled:opacity-50"
        style={{ borderColor: COLORS.border }}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && matches.length === 0 && (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          {query.trim()
            ? 'Nobody with an account matches that name. Exhibitors need an account before they can be entered — an admin creates one from Users.'
            : 'Everybody with an account is already on this show’s roster.'}
        </p>
      )}

      <ul className="space-y-1">
        {matches.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => add(person.id)}
              disabled={saving !== null}
              className="w-full text-left px-3 py-2 rounded border text-sm hover:bg-amber-50 transition-colors disabled:opacity-50"
              style={{ borderColor: COLORS.borderSoft, color: COLORS.text }}
            >
              {saving === person.id ? `Adding ${person.full_name}…` : person.full_name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
