import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import ContactGaitDeskForm, { type ContactTopic } from './ContactGaitDeskForm';

export const metadata: Metadata = {
  title: 'Contact GaitDesk',
  description: 'Get in touch with GaitDesk about running your shows, your account, or a problem with the app.',
};

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/** The form's topics, from the backend's own list. Null when the backend
 *  cannot be reached, which the page says rather than offering a form that
 *  could not be sent anyway. */
async function loadTopics(): Promise<ContactTopic[] | null> {
  try {
    const res = await fetch(`${API_URL}/gaitdesk-contact/topics`, {
      headers: { 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const topics = await readJsonBody(res);
    return Array.isArray(topics) && topics.length > 0 ? topics : null;
  } catch {
    return null;
  }
}

async function loadMe(): Promise<{ full_name: string; email: string } | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_URL}/users/me`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    const user = await readJsonBody(res);
    return user ? { full_name: user.full_name ?? '', email: user.email ?? '' } : null;
  } catch {
    // Prefilling is a convenience; the form works with empty boxes.
    return null;
  }
}

/**
 * Contact GaitDesk itself — the counterpart of a show's *Message the Show
 * Office*, one level up. Messages land in the admins' inbox at
 * `/admin/contact-messages` (`routers/gaitdesk_contact.py`).
 *
 * The first thing on the page sends show questions to the show: GaitDesk does
 * not run the shows listed here and cannot answer for a club's stalls or a
 * class's results, and a message that should have gone to a show office is
 * one somebody waits on for nothing.
 */
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const session = await auth();
  const [topics, me] = await Promise.all([loadTopics(), session ? loadMe() : Promise.resolve(null)]);
  const defaultTopic = topics?.some((t) => t.key === topic) ? topic : '';

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Home
      </Link>

      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Contact GaitDesk</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Questions about running your shows on GaitDesk, your account, or something not working right.
          Quick answers are in the{' '}
          <Link href="/faq" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>FAQ</Link>.
        </p>
      </div>

      <div
        className="mb-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
      >
        <strong>Asking about a particular show?</strong> Entries, stalls, bills and results are handled by
        each show&rsquo;s own office, not GaitDesk. Open the show and choose <em>Message the Show Office</em>.{' '}
        <Link href="/shows/upcoming" className="font-medium underline">Find a show</Link>
      </div>

      <div
        className="mb-6 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        {session
          ? <>We&rsquo;ll see your message comes from your GaitDesk account, and reply to the email address below.</>
          : <>You don&rsquo;t need an account to write to us. Leave an email address and we&rsquo;ll reply there.</>}
      </div>

      {topics ? (
        <ContactGaitDeskForm
          topics={topics}
          defaultTopic={defaultTopic}
          defaultName={me?.full_name ?? ''}
          defaultEmail={me?.email ?? ''}
        />
      ) : (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
        >
          The contact form is unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}
    </main>
  );
}
