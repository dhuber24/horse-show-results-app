import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import ContactShowForm from './ContactShowForm';

export default async function ContactShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Show
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Contact the show office</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <div
        className="mb-6 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Your message goes to this show&rsquo;s secretary and manager. You don&rsquo;t need an
        account to send one — leave an email address and they will reply there.
      </div>

      <ContactShowForm showId={id} showName={show.name} />
    </main>
  );
}
