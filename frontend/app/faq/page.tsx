import type { Metadata } from 'next';
import Link from 'next/link';
import { FAQ_CATEGORIES, faqPlainText } from '@/lib/faq';
import FaqBrowser from './FaqBrowser';

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Answers for spectators, exhibitors, trainers, show offices and ring crews using GaitDesk at ranch and western pleasure horse shows.',
};

/**
 * The public FAQ. No session is read and nothing is fetched: the questions are
 * `lib/faq.ts`, and the page is the same for everybody.
 *
 * The questions also go out as schema.org `FAQPage` data, which is what lets a
 * search engine show an answer under the result — the reason to put the text
 * in the page rather than load it.
 */
export default function FaqPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_CATEGORIES.flatMap((category) =>
      category.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: faqPlainText(item.a) },
      })),
    ),
  };

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <script
        type="application/ld+json"
        // `<` escaped so no answer text can close the script tag early.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />

      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Frequently Asked Questions</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          How GaitDesk works for everybody at a show — whether you&apos;re watching, showing, training, or running it.
        </p>
      </div>

      <FaqBrowser categories={FAQ_CATEGORIES} />

      <div
        className="rounded-lg border p-4 mt-10 text-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
      >
        <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Still have a question?</p>
        <p className="mt-1">
          For anything about a particular show — entries, stalls, your bill, a result — open the show and choose
          Message the Show Office. Each show&apos;s own office answers for it.
        </p>
        <p className="mt-1">For anything about GaitDesk itself, write to us.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/contact"
            className="font-medium px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Contact GaitDesk
          </Link>
          <Link
            href="/shows/upcoming"
            className="font-medium px-3 py-2 rounded border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
          >
            Find a show
          </Link>
        </div>
      </div>
    </main>
  );
}
