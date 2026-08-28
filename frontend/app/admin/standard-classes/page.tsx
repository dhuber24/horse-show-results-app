import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { fetchShowTypes } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import ClassCodeImporter, { type CatalogSummary } from './ClassCodeImporter';

/** Show types that publish a class-code catalog. Clubs do not have one — an
 *  NSBA-sanctioned show runs APHA or AQHA classes under APHA or AQHA codes. */
const CATALOG_CODES = ['APHA', 'AQHA', 'ApHC', 'FQHR'];

async function fetchCatalog(
  showTypeId: string,
  headers: Record<string, string>,
): Promise<CatalogSummary | null> {
  const res = await fetch(`${API_URL}/standard-class-imports/${showTypeId}`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

/** Loading the associations' published class-code lists.
 *
 *  Admin-only: these codes go on entry forms and into association reporting, so
 *  the person changing them is the one who owns the relationship with the
 *  association — not whoever happens to be running a show that week. */
export default async function StandardClassesPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user) redirect('/login');
  if (role !== 'ADMIN') redirect('/admin');

  const headers = await getAuthHeaders();
  const showTypes: { id: string; code: string; name?: string }[] = await fetchShowTypes();
  const catalogTypes = showTypes
    .filter((t) => CATALOG_CODES.includes(t.code))
    .sort((a, b) => CATALOG_CODES.indexOf(a.code) - CATALOG_CODES.indexOf(b.code));

  const catalogs = headers
    ? (
        await Promise.all(
          catalogTypes.map(async (t) => {
            const summary = await fetchCatalog(t.id, headers);
            return summary ? { ...summary, show_type_name: t.name ?? t.code } : null;
          }),
        )
      ).filter((c): c is NonNullable<typeof c> => c !== null)
    : [];

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Class Codes' }]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Association Class Codes
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Load an association&rsquo;s approved class list. The file is compared
          against what is already stored and you approve the changes before
          anything is written.
        </p>
      </div>

      {catalogs.length === 0 ? (
        <p
          className="rounded border p-4 text-sm"
          style={{ borderColor: '#d4b896', backgroundColor: '#fdf8eb', color: '#5c3d1e' }}
        >
          No breed show types are configured, so there is no catalog to load.
        </p>
      ) : (
        <ClassCodeImporter catalogs={catalogs} />
      )}
    </main>
  );
}
