import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import TrainerInbox, { type TrainerMessage } from './TrainerInbox';

export const metadata: Metadata = { title: 'Messages' };

/**
 * A trainer's inbox (migration 176): every Contact Trainer message they were
 * ever sent, kept after Pro lapses. The envelope in a trainer's top bar comes
 * here, and so does the link in each notice email (`#lead-{id}`).
 */
export default async function TrainerMessagesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=/profile/registry/messages');
  const headers = await getAuthHeaders();

  const res = await fetch(`${API_URL}/trainers/me/leads`, { headers: headers!, cache: 'no-store' });
  const messages = res.ok ? ((await readJsonBody(res)) as TrainerMessage[] | null) : null;
  if (!messages) {
    return (
      <main className="max-w-2xl mx-auto p-4 md:p-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Messages</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
          This inbox is for trainer accounts —{' '}
          <Link href="/register/trainer" className="underline" style={{ color: 'var(--accent)' }}>create a trainer account</Link>{' '}
          to be listed in the Trainer Registry.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/profile/registry" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← My Trainer Registry listing
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Messages</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          From exhibitors who used the Contact Trainer button on your listing. You&apos;re emailed a notice for each
          one; reply from here.
        </p>
      </div>
      <TrainerInbox initialMessages={messages} />
    </main>
  );
}
