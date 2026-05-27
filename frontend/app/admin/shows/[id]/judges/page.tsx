import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import JudgesEditor from './JudgesEditor';

async function fetchJudges(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/judges/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchShowTypes(headers: HeadersInit) {
  const res = await fetch(`${API_URL}/show-types/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function JudgesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, judges, showTypes] = await Promise.all([
    fetchShow(id),
    fetchJudges(id, headers || {}),
    fetchShowTypes(headers || {}),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Judges' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Judges</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — add judges and their association affiliation.
        </p>
      </div>

      <JudgesEditor showId={id} initialJudges={judges} showTypes={showTypes} />
    </main>
  );
}
