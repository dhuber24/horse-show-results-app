import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import MessageInbox, { type ContactMessage } from './MessageInbox';

async function loadMessages(showId: string): Promise<ContactMessage[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/shows/${showId}/contact/messages`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ShowMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, messages] = await Promise.all([fetchShow(id), loadMessages(id)]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Messages' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Messages</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <div
        className="rounded border px-4 py-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Questions sent from this show&rsquo;s public page, including from people who don&rsquo;t
        have an account. Nothing is emailed out — reply from your own mail client using the
        address the sender left.
      </div>

      <MessageInbox showId={id} initialMessages={messages} />
    </main>
  );
}
