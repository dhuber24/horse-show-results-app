'use client';

import { useState } from 'react';
import type { PlanInfo, ShowCompany } from '@/lib/show-companies';
import type { CompanyMoney, SubscriptionPrice, TrainerSubscription } from '@/lib/subscriptions';
import CompanySubscriptions from './CompanySubscriptions';
import PriceEditor from './PriceEditor';
import TrainerSubscriptions from './TrainerSubscriptions';

export type SubscriptionsTab = 'companies' | 'trainers' | 'prices';

const TABS: { key: SubscriptionsTab; label: string }[] = [
  { key: 'companies', label: 'Show Companies' },
  { key: 'trainers', label: 'Trainers' },
  { key: 'prices', label: 'Prices' },
];

function LoadFailed({ what }: { what: string }) {
  return (
    <p
      role="alert"
      className="text-sm rounded border p-3"
      style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
    >
      {what} could not be loaded.
    </p>
  );
}

export default function SubscriptionsManager({
  initialTab,
  companies,
  money,
  trainers,
  prices,
  plans,
}: {
  initialTab: SubscriptionsTab;
  companies: ShowCompany[] | null;
  money: CompanyMoney[] | null;
  trainers: TrainerSubscription[] | null;
  prices: SubscriptionPrice[] | null;
  plans: PlanInfo[];
}) {
  const [tab, setTab] = useState<SubscriptionsTab>(initialTab);

  function choose(next: SubscriptionsTab) {
    setTab(next);
    // In the address so a reload stays here, without re-reading the page for it.
    window.history.replaceState(null, '', next === 'companies' ? '?' : `?tab=${next}`);
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Subscriptions" className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(({ key, label }) => {
          const on = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => choose(key)}
              className="px-3 py-2 text-sm font-medium border-b-2 -mb-px"
              style={{ borderColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent)' : 'var(--muted)' }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'companies' &&
        (companies ? (
          <CompanySubscriptions initialCompanies={companies} money={money} plans={plans} />
        ) : (
          <LoadFailed what="The show companies" />
        ))}
      {tab === 'trainers' &&
        (trainers ? <TrainerSubscriptions trainers={trainers} /> : <LoadFailed what="The trainers" />)}
      {tab === 'prices' && (prices ? <PriceEditor initialPrices={prices} /> : <LoadFailed what="The prices" />)}
    </div>
  );
}
