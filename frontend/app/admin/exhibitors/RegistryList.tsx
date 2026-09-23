'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { holdingText, type MergeSummary } from '@/lib/exhibitor-merge';

interface RegistryRow {
  id: string;
  full_name: string;
  email: string | null;
  has_account: boolean;
  office_record: boolean;
  created_at: string;
  shows: number;
  class_entries: number;
}

type Scope = 'all' | 'office' | 'no_account' | 'accounts';

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: 'all', label: 'All', hint: 'Every exhibitor record.' },
  {
    value: 'office',
    label: 'Added by the office',
    hint: 'Typed in at a registration desk. These have no login and never appear under Users.',
  },
  { value: 'no_account', label: 'No account', hint: 'No login behind the record, however it was made.' },
  { value: 'accounts', label: 'Has an account', hint: 'Records with a login, which also appear under Users.' },
];

/**
 * Every exhibitor record, which is not the same list as every user.
 *
 * `/admin/users` is logins — roles, approval, passwords — and somebody the show
 * office typed in at a desk has none of that on purpose: an account belongs to
 * whoever will sign in to it. So from migration 140 there are real exhibitors,
 * with back numbers and entries and bills, that the Users screen will never
 * show, and this is the list they appear in.
 *
 * **Not deduplicated.** `/exhibitors/names` collapses records sharing a name
 * because an owner picker wants one row per person; a registry is asking which
 * records exist, and hiding one behind another is the question it was opened to
 * answer. Duplicates get their own section above this one.
 *
 * **Any two rows can be joined from here**, which is the half the duplicate
 * section above cannot do. That section lists pairs the app *spotted* — a
 * shared name or a shared email — and deliberately never offers an accountless
 * row nobody claims, so two records of one person spelled differently, or one
 * of them a seed leftover, appear in neither. Finding them is the thing a human
 * is better at, and a screen that shows you a duplicate and gives you no button
 * is worse than one that never showed you.
 *
 * The rename is here because nowhere else offers one. A name typed wrong at the
 * counter is printed on entries, back-number lists and published results, and
 * until this the only fix was to delete the record and lose what it held.
 * Offered only where there is **no account**: a linked record's name mirrors
 * `users.first_name`/`last_name` (`_sync_linked_exhibitor_name`), so editing it
 * here would be overwritten the next time that person touched their profile —
 * rename the account under Users instead.
 */
export default function RegistryList() {
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  /** First of the two picked for a join. The second press names the pair. */
  const [pairFrom, setPairFrom] = useState<RegistryRow | null>(null);
  const [pairWith, setPairWith] = useState<RegistryRow | null>(null);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, MergeSummary>>({});
  const [merged, setMerged] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ scope });
    if (query.trim()) params.set('q', query.trim());
    // Debounced: this fires on every keystroke in the search box.
    const timer = setTimeout(() => {
      fetch(`/api/exhibitors/registry?${params}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setRows(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!cancelled) setError('Could not load the exhibitor records.');
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, query, reloadKey]);

  /** Both records' full holdings, read before the direction is chosen. */
  const pickPair = async (from: RegistryRow, to: RegistryRow) => {
    setPairWith(to);
    // The record holding the login survives by default — it is the identity the
    // person goes on using. Only a default; the radios are on screen.
    setKeepId(to.has_account && !from.has_account ? to.id : from.id);
    setError(null);
    const loaded = await Promise.all(
      [from, to].map(async (row) => {
        const res = await fetch(`/api/exhibitors/${row.id}/merge-summary`);
        return [row.id, res.ok ? await res.json().catch(() => null) : null] as const;
      }),
    );
    setSummaries((prev) => {
      const next = { ...prev };
      for (const [id, summary] of loaded) if (summary) next[id] = summary;
      return next;
    });
  };

  const clearPair = () => {
    setPairFrom(null);
    setPairWith(null);
    setKeepId(null);
  };

  const merge = async () => {
    if (!pairFrom || !pairWith || !keepId) return;
    const removeId = keepId === pairFrom.id ? pairWith.id : pairFrom.id;
    const keptName = (keepId === pairFrom.id ? pairFrom : pairWith).full_name;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/exhibitors/${keepId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_exhibitor_id: removeId }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(errorMessage(body, 'Could not join those records.'));
      return;
    }
    clearPair();
    setMerged(keptName);
    setReloadKey((k) => k + 1);
  };

  const rename = async (row: RegistryRow) => {
    const name = draftName.trim();
    if (!name || name === row.full_name) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/exhibitors/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(errorMessage(body, 'Could not rename that record.'));
      return;
    }
    setEditing(null);
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, full_name: name } : r)) ?? null);
  };

  const activeScope = SCOPES.find((s) => s.value === scope);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
          All exhibitor records
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          A record the office cannot find is one it types in again, which is the duplicate this
          screen exists to stop. People added at a registration desk have no login, so they do not
          appear under Users.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a name or email…"
        className="w-full border rounded px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
      />

      <div className="flex flex-wrap gap-1.5">
        {SCOPES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setScope(option.value)}
            title={option.hint}
            className="px-2.5 py-1 rounded-full border text-xs font-medium transition-colors"
            style={
              scope === option.value
                ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent)', color: 'var(--surface)' }
                : { borderColor: 'var(--border)', color: 'var(--muted)' }
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      {activeScope && scope !== 'all' && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {activeScope.hint}
        </p>
      )}

      {merged && (
        <p
          className="rounded border p-3 text-sm"
          role="status"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--foreground)',
          }}
        >
          Joined. Everything now sits on <strong>{merged}</strong>.
        </p>
      )}

      {error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      {pairFrom && !pairWith && (
        <p
          className="rounded border p-2.5 text-sm flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-subtle)', color: 'var(--foreground)' }}
        >
          <span>
            Joining <strong>{pairFrom.full_name}</strong> — now pick the other record.
          </span>
          <button
            type="button"
            onClick={clearPair}
            className="text-xs hover:underline shrink-0"
            style={{ color: 'var(--muted)' }}
          >
            Cancel
          </button>
        </p>
      )}

      {pairFrom && pairWith && keepId && (
        <div
          className="rounded-lg border p-3 space-y-2.5"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
              Which record should everything end up on?
            </legend>
            {[pairFrom, pairWith].map((row) => (
              <label
                key={row.id}
                className="flex items-start gap-2 text-sm"
                style={{ color: 'var(--foreground)' }}
              >
                <input
                  type="radio"
                  name="registry-keep"
                  checked={keepId === row.id}
                  onChange={() => setKeepId(row.id)}
                  className="mt-1"
                />
                <span>
                  {row.full_name}
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                    {row.has_account ? 'Has an account' : 'No account'}
                    {row.office_record ? ' · added by the office' : ''}
                    {row.email ? ` · ${row.email}` : ''}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                    {summaries[row.id] ? holdingText(summaries[row.id]) : 'Reading what it holds…'}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div
            className="rounded border p-2.5 text-xs"
            style={{
              borderColor: 'var(--warning-border)',
              backgroundColor: 'var(--warning-bg)',
              color: 'var(--text-deep)',
            }}
          >
            Classes, back numbers, horses, memberships, signed waivers and payments move onto{' '}
            <strong>{(keepId === pairFrom.id ? pairFrom : pairWith).full_name}</strong>, and the
            other record is removed. Nothing here has checked that these are the same person.
            This cannot be undone in one press.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={merge}
              disabled={saving}
              className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {saving ? 'Joining…' : 'Yes, join them'}
            </button>
            <button
              type="button"
              onClick={clearPair}
              className="text-xs hover:underline"
              style={{ color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No exhibitor record matches.
        </p>
      ) : (
        <ul
          className="rounded-lg border divide-y overflow-hidden"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {rows.map((row) => (
            <li key={row.id} className="px-3 py-2.5">
              {editing === row.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(row);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="flex-1 min-w-0 basis-48 border rounded px-2 py-1.5 text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  />
                  <button
                    type="button"
                    onClick={() => rename(row)}
                    disabled={saving}
                    className="shrink-0 px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="shrink-0 text-xs hover:underline"
                    style={{ color: 'var(--muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {row.full_name}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                    {row.has_account ? 'Has an account' : 'No account'}
                    {row.office_record ? ' · added by the office' : ''}
                  </span>
                  <span className="text-xs w-full" style={{ color: 'var(--muted)' }}>
                    {row.email ?? 'No email on file'}
                    {' · '}
                    {row.shows} show{row.shows === 1 ? '' : 's'}
                    {' · '}
                    {row.class_entries} class{row.class_entries === 1 ? '' : 'es'}
                    {!row.has_account && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(row.id);
                            setDraftName(row.full_name);
                          }}
                          className="hover:underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          Rename
                        </button>
                      </>
                    )}
                    {/* Two presses, not a checkbox column: joining is rare and
                        destructive, and a row of ticks invites one. */}
                    {!pairFrom ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => {
                            setPairFrom(row);
                            setMerged(null);
                          }}
                          className="hover:underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          Join with…
                        </button>
                      </>
                    ) : pairFrom.id !== row.id && !pairWith ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => pickPair(pairFrom, row)}
                          className="hover:underline font-semibold"
                          style={{ color: 'var(--accent)' }}
                        >
                          Join with {pairFrom.full_name}
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
