import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import GaitDeskInbox, { type GaitDeskMessage } from './GaitDeskInbox';

/**
 * Messages sent to GaitDesk itself from `/contact` (migration 164). GaitDesk
 * admins only: a show office's mail is at `/admin/messages`, and this is the
 * mail about GaitDesk — clubs asking how to start, accounts, problems.
 */
export default async function ContactMessagesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/admin');

  const headers = await getAuthHeaders();
  let messages: GaitDeskMessage[] = [];
  let loadFailed = false;
  if (headers) {
    const res = await fetch(`${API_URL}/gaitdesk-contact/messages`, { headers, cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? await readJsonBody(res) : null;
    if (Array.isArray(body)) messages = body;
    else loadFailed = true;
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Contact Messages' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Contact Messages</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Messages to GaitDesk from the public Contact page, including from people without an account. Each
          admin is also emailed a copy where mail is set up. Reply from your own mail client using the
          address the sender left.
        </p>
      </div>

      {loadFailed ? (
        <p className="text-sm" style={{ color: 'var(--error)' }}>
          The messages could not be loaded. Refresh to try again.
        </p>
      ) : (
        <GaitDeskInbox initialMessages={messages} />
      )}
    </main>
  );
}
