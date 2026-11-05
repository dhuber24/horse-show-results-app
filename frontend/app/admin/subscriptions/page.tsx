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
 * **An admin changes a plan here and nowhere else**: the other screens say what
 * somebody is on and link here, `?company=` or `?trainer=` opening their row.
 *
 * It quotes and it posts to the endpoints that already own each job. A company's
 * invoices and usage stay on its own page, which each row links to.
 */
export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; company?: string; trainer?: string }>;
}) {
  const { tab, company, trainer } = await searchParams;
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

  const initialTab: SubscriptionsTab = company
    ? 'companies'
    : trainer || tab === 'trainers'
      ? 'trainers'
      : tab === 'prices'
        ? 'prices'
        : 'companies';

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Manage Subscriptions' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Manage Subscriptions</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Who is on which plan, what they owe, and what GaitDesk charges. This is where plans are changed. A
          show&apos;s plan is its show company&apos;s, so shows are managed through their companies. Give a plan away
          as a comp or a trial from a row&apos;s Manage.
        </p>
      </div>
      <SubscriptionsManager
        initialTab={initialTab}
        companies={companies}
        money={money}
        trainers={trainers}
        prices={prices}
        plans={mine?.plans ?? []}
        linkedCompany={company}
        linkedTrainer={trainer}
      />
    </main>
  );
}
