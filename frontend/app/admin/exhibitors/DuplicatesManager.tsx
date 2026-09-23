'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { holdingText, type MergeSummary as Summary } from '@/lib/exhibitor-merge';

interface Record_ {
  id: string;
  full_name: string;
  has_account: boolean;
  office_record: boolean;
  email: string | null;
  created_at: string;
  summary: Summary;
}

interface Group {
  reason: 'email' | 'name' | string;
  label: string;
  records: Record_[];
}

/**
 * Joining two records of one person, from the registry rather than from a desk.
 *
 * The desk has its own merge, scoped to the show its staff are working. This is
 * the one that reaches everything — including the case the desk deliberately
 * refuses, where both records carry a login. Somebody who made a second account
 * is a real thing; the merge puts every entry on one record, and the account
 * left holding nothing is then an ordinary account to close from Users.
 *
 * Grouped by the reason to suspect a duplicate rather than listed flat, because
 * the two reasons are not equally good and a screen that ran them together
 * would invite the same press for both. A shared **email** is the office having
 * written down the address an account was later opened with. A shared **name**
 * is no evidence at all — there are two Sarah Johnsons at plenty of shows, and
 * nothing here decides otherwise.
 */
export default function DuplicatesManager() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepIds, setKeepIds] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await fetch('/api/exhibitors/duplicates');
    if (!res.ok) {
      setError('Could not load the duplicate list.');
      setGroups([]);
      return;
    }
    const data = await res.json().catch(() => []);
    setGroups(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const groupKey = (group: Group) => `${group.reason}:${group.label}`;

  /** The record holding the login is the one to keep by default. */
  const defaultKeep = (group: Group) =>
    group.records.find((r) => r.has_account)?.id ?? group.records[0].id;

  const merge = async (group: Group) => {
    const keepId = keepIds[groupKey(group)] ?? defaultKeep(group);
    const others = group.records.filter((r) => r.id !== keepId);
    setSaving(true);
    setError(null);
    for (const other of others) {
      const res = await fetch(`/api/exhibitors/${keepId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove_exhibitor_id: other.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errorMessage(body, 'Could not join those records.'));
        setSaving(false);
        await load();
        return;
      }
    }
    setSaving(false);
    setConfirming(null);
    setDone(group.records.find((r) => r.id === keepId)?.full_name ?? null);
    await load();
  };

  if (groups === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {done && (
        <p
          className="rounded border p-3 text-sm"
          role="status"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--foreground)',
          }}
        >
          Joined. Everything now sits on <strong>{done}</strong>.
        </p>
      )}

      {error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Nobody is on file twice. Records typed in at a registration desk turn up here once the
          same person opens an account or is typed in again.
        </p>
      )}

      {groups.map((group) => {
        const key = groupKey(group);
        const keepId = keepIds[key] ?? defaultKeep(group);
        const kept = group.records.find((r) => r.id === keepId);
        return (
          <section
            key={key}
            className="rounded-lg border p-4 space-y-3"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                {group.records[0].full_name}
              </h2>
              <span
                className="text-xs"
                style={{ color: group.reason === 'email' ? 'var(--accent)' : 'var(--muted)' }}
              >
                {group.reason === 'email'
                  ? `Same email — ${group.label}`
                  : 'Same name only — may be two different people'}
              </span>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
                Keep
              </legend>
              {group.records.map((record) => (
                <label
                  key={record.id}
                  className="flex items-start gap-2 text-sm"
                  style={{ color: 'var(--foreground)' }}
                >
                  <input
                    type="radio"
                    name={`keep-${key}`}
                    checked={keepId === record.id}
                    onChange={() => setKeepIds({ ...keepIds, [key]: record.id })}
                    className="mt-1"
                  />
                  <span>
                    {record.full_name}
                    <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                      {record.has_account ? 'Has an account' : 'No account'}
                      {record.office_record ? ' · added by the office' : ''}
                      {record.email ? ` · ${record.email}` : ''}
                    </span>
                    <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                      {holdingText(record.summary)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {confirming === key ? (
              <div className="space-y-2">
                <div
                  className="rounded border p-2.5 text-xs"
                  style={{
                    borderColor: 'var(--warning-border)',
                    backgroundColor: 'var(--warning-bg)',
                    color: 'var(--text-deep)',
                  }}
                >
                  Classes, back numbers, horses, memberships, signed waivers and payments from the
                  other {group.records.length === 2 ? 'record' : 'records'} move onto{' '}
                  <strong>{kept?.full_name}</strong>, which then holds all of it. The others are
                  removed. This cannot be undone in one press.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => merge(group)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {saving ? 'Joining…' : 'Yes, join them'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(key)}
                className="px-3 py-1.5 rounded border text-sm font-medium hover:bg-amber-50 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
              >
                Join into {kept?.full_name}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

