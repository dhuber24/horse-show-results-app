'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { foldedOwnCompanies, formatDay, type ShowCompany } from '@/lib/show-companies';
import { companySubscriptionHref } from '@/lib/subscriptions';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;

type Filter = 'all' | 'organizations' | 'independent' | 'requests' | 'upgrades';

/** Whether the company has asked for a feature it does not have (migration 144),
 *  or for Pro+ (migration 169). */
function asksForUpgrade(company: ShowCompany): boolean {
  return company.features.some((f) => f.requested_at && !f.enabled) || Boolean(company.pro_plus_requested_at);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Companies somebody is waiting on come first -- asking to join, or asking for
 * an upgrade -- then organizations, then the independents: there is one of
 * those for every show manager and secretary who works for nobody (migration
 * 143), and they would otherwise bury the handful of clubs this screen is
 * mostly for.
 */
function rank(company: ShowCompany): number {
  if (company.join_requests.length > 0 || asksForUpgrade(company)) return 0;
  return company.owner_user_id ? 2 : 1;
}

export default function CompaniesManager({ initialCompanies: companies }: { initialCompanies: ShowCompany[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const requestCount = companies.filter((c) => c.join_requests.length > 0).length;
  const upgradeCount = companies.filter(asksForUpgrade).length;
  // An independent who now works for an organization is listed under it, not
  // as a row of their own; searching their name finds every company they're in.
  const folded = useMemo(() => foldedOwnCompanies(companies), [companies]);
  const listedCount = companies.length - folded.size;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) => Boolean(q) || !folded.has(c.id))
      .filter((c) =>
        filter === 'organizations'
          ? !c.owner_user_id
          : filter === 'independent'
            ? Boolean(c.owner_user_id)
            : filter === 'requests'
              ? c.join_requests.length > 0
              : filter === 'upgrades'
                ? asksForUpgrade(c)
                : true,
      )
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.members.some((m) => m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
      )
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [companies, filter, folded, query]);
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
            {filter === 'all' && !query.trim() ? `All Companies (${listedCount})` : `Companies (${shown.length} of ${listedCount})`}
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
              <option value="upgrades">Asking to upgrade ({upgradeCount})</option>
            </select>
          </div>
        </div>
        {folded.size > 0 && !query.trim() && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {folded.size === 1
              ? "1 independent now works for an organization, so their own company isn't listed."
              : `${folded.size} independents now work for an organization, so their own companies aren't listed.`}{' '}
            Search a name to see every company somebody is in.
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
              const worksFor = folded.get(company.id);
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
                    {/* Only reached by a search: say why it isn't on the list. */}
                    {worksFor && (
                      <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
                        Now works for {worksFor.join(', ')} — listed only when searched
                      </p>
                    )}
                  </div>
                  {/* What it is on, to read. A plan is changed at Manage
                      Subscriptions and nowhere else. */}
                  <div className="flex flex-col gap-1.5 sm:items-end">
                    <span className="text-sm" style={{ color: 'var(--text-deep)' }}>
                      {company.effective_plan_label ?? company.plan_label}
                    </span>
                    <Link
                      href={companySubscriptionHref(company.id)}
                      className="text-sm font-medium hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Manage subscription
                    </Link>
                    {company.effective_plan === 'pro_plus' && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
                        title={company.renews_pro_plus ? 'Paid year; renews as Pro+' : `Paid year; then ${company.plan_label}`}
                      >
                        Pro+ through{' '}
                        {formatDay(
                          [...(company.subscriptions ?? [])].sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0]?.ends_on,
                        )}
                      </span>
                    )}
                    {/* Migration 175: an unpaid renewal freezes the company's shows. */}
                    {company.pro_plus_lapsed_since && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
                        title="Sets up no show, and its unfinished shows are frozen, until it renews or moves to Basic or Pro"
                      >
                        Pro+ renewal unpaid since {formatDay(company.pro_plus_lapsed_since)}
                      </span>
                    )}
                    {company.pro_plus_requested_at && company.effective_plan !== 'pro_plus' && (
                      <Link
                        href={companySubscriptionHref(company.id)}
                        className="block w-fit text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
                        suppressHydrationWarning
                      >
                        Asked for Pro+ {formatDate(company.pro_plus_requested_at)}
                      </Link>
                    )}
                    {company.plan === 'pro' && company.members.length === 0 && (
                      <span className="text-xs" style={{ color: 'var(--warning)' }}>
                        On Pro, but reaches nobody yet — add an account
                      </span>
                    )}
                    {/* Moving to Pro answers every request, so the note links to
                        where that is done. */}
                    {company.features
                      .filter((f) => f.requested_at && !f.enabled)
                      .slice(0, 1)
                      .map((f) => (
                        <Link
                          key={f.key}
                          href={companySubscriptionHref(company.id)}
                          className="block w-fit text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
                          suppressHydrationWarning
                        >
                          Asked for {f.plan} {formatDate(f.requested_at)}
                          {f.requested_by_name ? ` · ${f.requested_by_name}` : ''}
                        </Link>
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
