import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import MatrixSetupClient, {
  CatalogPayload,
  RingItem,
} from './MatrixSetupClient';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

export default async function ShowSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);

  const [rings, standardRings, catalog] = await Promise.all([
    fetchAuthed<RingItem[]>(`${API_URL}/shows/${id}/rings/`, []),
    fetchAuthed<{ id: string; name: string }[]>(
      `${API_URL}/standard-setup/rings`,
      [],
    ),
    fetchAuthed<CatalogPayload | null>(
      `${API_URL}/standard-setup/catalog?show_type_id=${encodeURIComponent(show.show_type_id)}`,
      null,
    ),
  ]);

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Setup' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Setup
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Pick the rings, disciplines, and classes for <strong>{show.name}</strong>.
          Selections from the standard {show.show_type_code ?? 'library'} library create
          per-show divisions, sections, and classes in one apply.
        </p>
      </div>

      <MatrixSetupClient
        showId={id}
        showTypeCode={show.show_type_code ?? null}
        showName={show.name}
        existingRings={rings}
        standardRingNames={standardRings.map((r) => r.name)}
        catalog={catalog}
      />
    </main>
  );
}
