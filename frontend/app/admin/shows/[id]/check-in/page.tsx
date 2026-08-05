import { fetchShow, fetchAssociations, fetchBreeds, fetchHorseColors } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import CheckInBoard from './CheckInBoard';

export default async function ShowCheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();

  // The lookups behind the add-a-horse form. They fail open to empty lists —
  // a missing colour list must not take the paperwork sweep down with it.
  const [show, associations, breeds, colors] = await Promise.all([
    fetchShow(id),
    fetchAssociations(headers || undefined).catch(() => []),
    fetchBreeds().catch(() => []),
    fetchHorseColors().catch(() => []),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Paperwork Check-In' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Paperwork Check-In</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <div
        className="rounded border px-4 py-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Sign off here only for documents you have physically inspected: the foaling date and
        registration numbers on the horse&rsquo;s papers, and the rider&rsquo;s membership cards.
        Each sign-off is recorded against the exact value on file at the time — if the exhibitor
        edits it afterwards, the check reappears as needing another look.
      </div>

      <CheckInBoard showId={id} associations={associations} breeds={breeds} colors={colors} />
    </main>
  );
}
