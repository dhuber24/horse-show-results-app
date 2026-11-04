import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { fetchMyFeatures, type ShowCompany } from '@/lib/show-companies';
import type { CompanyMoney, SubscriptionPrice, TrainerSubscription } from '@/lib/subscriptions';
import SubscriptionsManager, { type SubscriptionsTab } from './SubscriptionsManager';

async function read<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const res = await fetch(`${API_URL}${url}`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  return (await readJsonBody(res)) as T | null;
}

/**
 * Manage Subscriptions: every show company's plan and every trainer's Pro, what
 * each owes, what has been given away, and what GaitDesk charges (migration 179).
 *
 * It quotes and it posts to the endpoints that already own each job. A company's
 * invoices and usage stay on its own page, which each row links to.
 */
export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const headers = await getAuthHeaders();
  const [companies, money, trainers, prices, mine] = headers
    ? await Promise.all([
        read<ShowCompany[]>('/show-companies/', headers),
        read<CompanyMoney[]>('/subscriptions/companies', headers),
        read<TrainerSubscription[]>('/subscriptions/trainers', headers),
        read<SubscriptionPrice[]>('/subscriptions/prices', headers),
        fetchMyFeatures(headers),
      ])
    : [null, null, null, null, null];

  const initialTab: SubscriptionsTab = tab === 'trainers' || tab === 'prices' ? tab : 'companies';

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Manage Subscriptions' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Manage Subscriptions</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Who is on which plan, what they owe, and what GaitDesk charges. A show&apos;s plan is its show
          company&apos;s, so shows are managed through their companies. Give a plan away as a comp or a trial from a
          row&apos;s Manage.
        </p>
      </div>
      <SubscriptionsManager
        initialTab={initialTab}
        companies={companies}
        money={money}
        trainers={trainers}
        prices={prices}
        plans={mine?.plans ?? []}
      />
    </main>
  );
}
