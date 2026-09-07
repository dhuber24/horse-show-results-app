import Breadcrumbs from '@/components/Breadcrumbs';
import { fetchAssociations } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import JudgesManager, { type Judge, type AssociationOption } from './JudgesManager';

/**
 * The judge registry.
 *
 * A judge is a person, not a line on one show — show setup picks from here and
 * reads the details off the registry rather than restating them, so a
 * correction made here reaches every show that judge has ever worked.
 */
export default async function AdminJudgesPage() {
  const headers = await getAuthHeaders();

  const [judges, associations] = await Promise.all([
    (async (): Promise<Judge[]> => {
      if (!headers) return [];
      // include_inactive: the registry is the whole list, and a retired judge
      // is exactly the row somebody has come here to put back.
      const res = await fetch(`${API_URL}/judges/?include_inactive=true`, {
        headers,
        cache: 'no-store',
      });
      return res.ok ? ((await readJsonBody(res)) ?? []) : [];
    })(),
    (async (): Promise<AssociationOption[]> => {
      try {
        return await fetchAssociations(headers || undefined);
      } catch {
        return [];
      }
    })(),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Judge Registry' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Judge Registry</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          One record per judge, shared by every show they work. Show setup picks
          from this list and displays these details read-only, so a correction
          here reaches all of them.
        </p>
      </div>
      <JudgesManager initialJudges={judges} associations={associations} />
    </main>
  );
}
