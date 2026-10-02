import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import MessageInbox, { type ContactMessage } from '@/components/MessageInbox';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';

/**
 * Every show's messages at once — what the envelope in the top bar opens away
 * from a show. The same inbox as a show's own Messages page, across every show
 * the reader works (`GET /my-messages`, scoped by `show_access.py`), each
 * message naming its show. Read and archive go to that show's own endpoint.
 */
export default async function AllMessagesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN' && role !== 'SHOW_MANAGER' && role !== 'SHOW_SECRETARY') redirect('/admin');

  const headers = await getAuthHeaders();
  let messages: ContactMessage[] = [];
  let loadFailed = false;
  if (headers) {
    const res = await fetch(`${API_URL}/my-messages`, { headers, cache: 'no-store' }).catch(() => null);
    if (res?.ok) messages = (await readJsonBody(res)) ?? [];
    else loadFailed = true;
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Messages' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Messages
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {role === 'ADMIN' ? 'Every show.' : 'Every show you work.'} Questions sent from each
          show&rsquo;s public page, including from people who don&rsquo;t have an account. Nothing is
          emailed out — reply from your own mail client using the address the sender left.
        </p>
      </div>

      {loadFailed ? (
        <p className="text-sm" style={{ color: 'var(--error)' }}>
          The messages could not be loaded. Refresh to try again.
        </p>
      ) : (
        <MessageInbox initialMessages={messages} combined />
      )}
    </main>
  );
}
