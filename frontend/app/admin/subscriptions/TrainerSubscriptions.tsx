'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { GRANT_LABELS, trainerChips, type TrainerSubscription } from '@/lib/subscriptions';
import { proThrough } from '@/lib/trainer-registry';
import AdminTrainerPro from '../trainers/[id]/AdminTrainerPro';
import { Chips, CountFilters } from './_shared';

type Filter = 'all' | 'attention' | 'pro' | 'card' | 'given' | 'basic';

const LABELS: Record<Filter, string> = {
  all: 'All',
  attention: 'Needs attention',
  pro: 'Pro',
  card: 'Paying by card',
  given: 'Comped or on trial',
  basic: 'Basic',
};

function howPaid(trainer: TrainerSubscription): string {
  if (trainer.pro_grant) return GRANT_LABELS[trainer.pro_grant];
  if (trainer.pays_by_card) return 'Card subscription';
  return 'Recorded by an admin';
}

/**
 * Every trainer's plan. A row opens onto the panel their own admin page has, so
 * Pro is recorded, given away and ended the same way from either screen.
 *
 * Reads its rows from the page rather than state: that panel refreshes the page
 * when it saves, and the row should follow.
 */
export default function TrainerSubscriptions({ trainers }: { trainers: TrainerSubscription[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const needsSomebody = (t: TrainerSubscription) => trainerChips(t).some((chip) => chip.urgent);
  const matches = (t: TrainerSubscription, f: Filter) =>
    f === 'all'
      ? true
      : f === 'attention'
        ? needsSomebody(t)
        : f === 'pro'
          ? t.is_pro
          : f === 'card'
            ? t.pays_by_card
            : f === 'given'
              ? t.is_pro && Boolean(t.pro_grant)
              : !t.is_pro;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trainers
      .filter((t) => matches(t, filter))
      .filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          (t.business_name ?? '').toLowerCase().includes(q) ||
          (t.email ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => Number(needsSomebody(b)) - Number(needsSomebody(a)) || Number(b.is_pro) - Number(a.is_pro));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainers, filter, query]);

  const counts = (Object.keys(LABELS) as Filter[]).map((key) => ({
    key,
    label: LABELS[key],
    count: trainers.filter((t) => matches(t, key)).length,
  }));

  return (
    <div className="space-y-4">
      <CountFilters counts={counts} active={filter} onChoose={setFilter} />
      <div>
        <label htmlFor="subscription-trainer-search" className="sr-only">Search trainers</label>
        <input
          id="subscription-trainer-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, business or email"
          className="border rounded px-3 py-1.5 text-sm w-full sm:w-72"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing matches.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((trainer) => {
            const isOpen = open === trainer.id;
            return (
              <li key={trainer.id} className="border rounded" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/trainers/${trainer.id}`} className="font-medium hover:underline" style={{ color: 'var(--foreground)' }}>
                      {trainer.name}
                    </Link>
                    {trainer.business_name && (
                      <span className="text-sm" style={{ color: 'var(--muted)' }}> · {trainer.business_name}</span>
                    )}
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-deep)' }}>
                      {trainer.is_pro ? (
                        <>
                          Pro {proThrough(trainer.pro_until)}
                          <span style={{ color: 'var(--muted)' }}> · {howPaid(trainer)}</span>
                        </>
                      ) : (
                        'Basic'
                      )}
                      {!trainer.is_public && <span style={{ color: 'var(--muted)' }}> · Not listed</span>}
                    </p>
                    {trainer.pro_grant_note && trainer.is_pro && (
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>{trainer.pro_grant_note}</p>
                    )}
                    <Chips chips={trainerChips(trainer)} />
                  </div>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`trainer-manage-${trainer.id}`}
                    onClick={() => setOpen(isOpen ? null : trainer.id)}
                    className="text-sm font-medium hover:underline text-left shrink-0"
                    style={{ color: 'var(--accent)' }}
                  >
                    {isOpen ? '▾' : '▸'} Manage
                  </button>
                </div>
                {isOpen && (
                  <div id={`trainer-manage-${trainer.id}`} className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
                    <AdminTrainerPro trainer={trainer} />
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
