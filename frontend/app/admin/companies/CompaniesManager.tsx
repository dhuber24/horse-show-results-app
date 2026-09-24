'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import type { ShowCompany } from '@/lib/show-companies';
import FeatureToggle from './FeatureToggle';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;

type Filter = 'all' | 'organizations' | 'independent' | 'requests';

/**
 * Companies somebody is waiting on come first, then organizations, then the
 * independents -- there is one of those for every show manager and secretary
 * who works for nobody (migration 143), and they would otherwise bury the
 * handful of clubs this screen is mostly for.
 */
function rank(company: ShowCompany): number {
  if (company.join_requests.length > 0) return 0;
  return company.owner_user_id ? 2 : 1;
}

export default function CompaniesManager({ initialCompanies }: { initialCompanies: ShowCompany[] }) {
  const router = useRouter();
  const [companies, setCompanies] = useState<ShowCompany[]>(initialCompanies);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const requestCount = companies.filter((c) => c.join_requests.length > 0).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) =>
        filter === 'organizations'
          ? !c.owner_user_id
          : filter === 'independent'
            ? Boolean(c.owner_user_id)
            : filter === 'requests'
              ? c.join_requests.length > 0
              : true,
      )
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.members.some((m) => m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
      )
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [companies, filter, query]);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/show-companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), notes: notes.trim() || null }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(false);
      setError(errorMessage(body, 'The show company could not be added.'));
      return;
    }
    // Straight to the company, because a company with no members and nothing
    // switched on does nothing -- the next two things to do are on that page.
    router.push(`/admin/companies/${body.id}`);
  };

  return (
    <div className="space-y-6">
      <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Add a show company</h2>
          {!isAdding && (
            <button
              onClick={() => {
                setError(null);
                setIsAdding(true);
              }}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
            >
              Add Company
            </button>
          )}
        </div>
        {isAdding && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="new-company-name" className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
                Name *
              </label>
              <input
                id="new-company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minnesota Paint Horse Club"
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-company-notes" className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
                Notes
              </label>
              <textarea
                id="new-company-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Billing arrangement, main contact…"
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              />
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Only GaitDesk admins see these.</span>
            </div>
            {error && (
              <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={create}
                disabled={busy || !name.trim()}
                title={!name.trim() ? 'Type the company name first' : busy ? 'Adding…' : undefined}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
              >
                {busy ? 'Adding…' : 'Add Company'}
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setName('');
                  setNotes('');
                  setError(null);
                }}
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            {filter === 'all' && !query.trim() ? `All Companies (${companies.length})` : `Companies (${shown.length} of ${companies.length})`}
          </h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="company-search" className="sr-only">Search companies</label>
            <input
              id="company-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by company, person or email"
              className="border rounded px-3 py-1.5 text-sm sm:w-64"
              style={inputStyle}
            />
            <label htmlFor="company-filter" className="sr-only">Show</label>
            <select
              id="company-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="border rounded px-3 py-1.5 text-sm"
              style={inputStyle}
            >
              <option value="all">All companies</option>
              <option value="organizations">Organizations</option>
              <option value="independent">Independent people</option>
              <option value="requests">Asking to join ({requestCount})</option>
            </select>
          </div>
        </div>
        {toggleError && (
          <p
            role="alert"
            className="text-sm rounded border p-3"
            style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          >
            {toggleError}
          </p>
        )}
        {companies.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No show companies yet.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing matches.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((company) => {
              const owner = company.owner_user_id
                ? company.members.find((m) => m.user_id === company.owner_user_id)
                : undefined;
              return (
                <li
                  key={company.id}
                  className="border rounded p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/companies/${company.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {company.name}
                      </Link>
                      {company.owner_user_id && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
                          title="An independent show manager or secretary. Made with their account, and named after them."
                        >
                          Independent
                        </span>
                      )}
                      {company.join_requests.length > 0 && (
                        <Link
                          href={`/admin/companies/${company.id}`}
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
                        >
                          {company.join_requests.length} asking to join
                        </Link>
                      )}
                    </div>
                    <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                      {owner
                        ? owner.email
                        : company.members.length === 1
                          ? '1 account'
                          : `${company.members.length} accounts`}
                    </p>
                  </div>
                  {/* The switch sits on the row so a feature can be turned on
                      without opening the company. */}
                  <div className="flex flex-col gap-2 sm:items-end">
                    {company.features.map((feature) => (
                      <div key={feature.key} className="flex items-center gap-2 sm:flex-row-reverse">
                        <FeatureToggle
                          companyId={company.id}
                          companyName={company.name}
                          feature={feature}
                          onChange={(updated) =>
                            setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                          }
                          onError={setToggleError}
                        />
                        <span className="text-sm" style={{ color: 'var(--text-deep)' }}>
                          {feature.label}
                          {feature.enabled && company.members.length === 0 && (
                            <span className="block text-xs" style={{ color: 'var(--warning)' }}>
                              On, but reaches nobody yet — add an account
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
