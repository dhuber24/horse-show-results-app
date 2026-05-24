import { fetchShow } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import BackNumberForm from './BackNumberForm';
import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';

async function fetchBackNumberExhibitors(showId: string, headers: HeadersInit) {
  const API_URL = process.env.API_URL || 'http://backend:8000';
  const res = await fetch(`${API_URL}/shows/${showId}/back-numbers/exhibitors`, {
    cache: 'no-store',
    headers,
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function BackNumbersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, enrichedExhibitors] = await Promise.all([
    fetchShow(id),
    fetchBackNumberExhibitors(id, headers || {}),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Breadcrumbs crumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Shows', href: '/admin/shows' },
        { label: show.name, href: `/admin/shows/${id}` },
        { label: 'Back Numbers' },
      ]} />
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Back Number Assignment</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — one back number per exhibitor, valid across all classes
        </p>
      </div>
      {enrichedExhibitors.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No exhibitors entered in this show yet.</p>
      ) : (
        <BackNumberForm showId={id} exhibitors={enrichedExhibitors} />
      )}
    </main>
  );
}
