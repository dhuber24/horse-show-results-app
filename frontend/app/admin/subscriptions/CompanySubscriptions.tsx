'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { foldedOwnCompanies, type PlanInfo, type ShowCompany } from '@/lib/show-companies';
import { companyChips, companyMoneyLine, companyPlanLine, type CompanyMoney } from '@/lib/subscriptions';
import CompanyPlan from './CompanyPlan';
import PlanPicker from './PlanPicker';
import { Chips, CountFilters } from './_shared';

type Filter = 'all' | 'attention' | 'given' | 'free' | 'basic' | 'pro' | 'pro_plus';

/**
 * Every show company's plan and money, and the one place an admin changes a plan.
 * Show Companies and a company's own page say what it is on and link here, with
 * `linkedCompany` opening its row. A row opens onto the plan cards, its Pro+ years
 * and its comps and trials.
 *
 * Companies somebody is waiting on come first, then organizations, then the
 * independents, of whom there is one per show manager and most have run nothing.
 */
export default function CompanySubscriptions({
  initialCompanies,
  money,
  plans,
  linkedCompany,
}: {
  initialCompanies: ShowCompany[];
  money: CompanyMoney[] | null;
  plans: PlanInfo[];
  linkedCompany?: string;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState(initialCompanies);
  // A year started on credit issues an invoice, so a refresh brings new figures too.
  useEffect(() => setCompanies(initialCompanies), [initialCompanies]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(linkedCompany ?? null);
  // Whose form for starting a Pro+ year is open: its row's button says so from
  // outside the plan cards.
  const [yearFormFor, setYearFormFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (linkedCompany) document.getElementById(`company-row-${linkedCompany}`)?.scrollIntoView({ block: 'start' });
  }, [linkedCompany]);

  const moneyById = useMemo(() => new Map((money ?? []).map((m) => [m.company_id, m])), [money]);
  const folded = useMemo(() => foldedOwnCompanies(companies), [companies]);
  const listed = useMemo(() => companies.filter((c) => !folded.has(c.id)), [companies, folded]);
  const needsSomebody = (c: ShowCompany) => companyChips(c, moneyById.get(c.id)).some((chip) => chip.urgent);
  const isGiven = (c: ShowCompany) => Boolean(c.active_grant_id);

  const matches = (c: ShowCompany, f: Filter) =>
    f === 'all'
      ? true
      : f === 'attention'
        ? needsSomebody(c)
        : f === 'given'
          ? isGiven(c)
          : c.effective_plan === f;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Searching a person finds every company they are in, folded or not, and a
    // link from a folded company's own page has to arrive at its row.
    return (q ? companies : companies.filter((c) => !folded.has(c.id) || c.id === linkedCompany))
      .filter((c) => matches(c, filter))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.members.some((m) => m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          Number(needsSomebody(b)) - Number(needsSomebody(a)) ||
          Number(Boolean(a.owner_user_id)) - Number(Boolean(b.owner_user_id)) ||
          a.name.localeCompare(b.name),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, folded, linkedCompany, filter, query, moneyById]);

  const update = (next: ShowCompany) => {
    setCompanies((prev) => prev.map((c) => (c.id === next.id ? next : c)));
    router.refresh();
  };

  const counts = (['all', 'attention', 'given', 'free', 'basic', 'pro', 'pro_plus'] as Filter[]).map((key) => ({
    key,
    label: { all: 'All', attention: 'Needs attention', given: 'Comped or on trial', free: 'Free', basic: 'Basic', pro: 'Pro', pro_plus: 'Pro+' }[key],
    count: listed.filter((c) => matches(c, key)).length,
  }));

  return (
    <div className="space-y-4">
      <CountFilters counts={counts} active={filter} onChoose={setFilter} />
      <div>
        <label htmlFor="subscription-company-search" className="sr-only">Search companies</label>
        <input
          id="subscription-company-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by company, person or email"
          className="border rounded px-3 py-1.5 text-sm w-full sm:w-72"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        />
      </div>
      {money === null && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          What each company owes could not be loaded. Its own page still has it.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="text-sm rounded border p-3"
          style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
        >
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing matches.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((company) => {
            const isOpen = open === company.id;
            const figures = moneyById.get(company.id);
            const planLine = companyPlanLine(company);
            return (
              <li
                key={company.id}
                id={`company-row-${company.id}`}
                className="border rounded scroll-mt-20"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <div className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/companies/${company.id}`} className="font-medium hover:underline" style={{ color: 'var(--foreground)' }}>
                        {company.name}
                      </Link>
                      {company.owner_user_id && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
                          Independent
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-deep)' }}>
                      {company.effective_plan_label ?? company.plan_label}
                      {planLine && <span style={{ color: 'var(--muted)' }}> · {planLine}</span>}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>{companyMoneyLine(figures)}</p>
                    <Chips chips={companyChips(company, figures)} />
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end shrink-0">
                    <PlanPicker
                      company={company}
                      onChange={update}
                      onError={setError}
                      onProPlus={() => {
                        setOpen(company.id);
                        setYearFormFor(yearFormFor === company.id ? null : company.id);
                      }}
                    />
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`company-manage-${company.id}`}
                      onClick={() => {
                        setOpen(isOpen ? null : company.id);
                        setYearFormFor(null);
                      }}
                      className="text-sm font-medium hover:underline text-left sm:text-right"
                      style={{ color: 'var(--accent)' }}
                    >
                      {isOpen ? '▾' : '▸'} Manage
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div id={`company-manage-${company.id}`} className="border-t p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
                    <CompanyPlan
                      company={company}
                      plans={plans}
                      startingYear={yearFormFor === company.id}
                      onStartingYear={(on) => setYearFormFor(on ? company.id : null)}
                      onChange={update}
                      onError={setError}
                    />
                    <p className="text-sm">
                      <Link href={`/admin/companies/${company.id}`} className="underline" style={{ color: 'var(--accent)' }}>
                        Invoices and usage statement on {company.name}&apos;s page
                      </Link>
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
