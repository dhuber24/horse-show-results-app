'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { faqSegments, filterFaqs, type FaqBlock, type FaqCategory } from '@/lib/faq';

/**
 * The FAQ's questions: a search box, a row of jump links to each audience,
 * and one `<details>` per question.
 *
 * Which questions are open is held in state rather than left to the browser,
 * so that a search can open everything it found (the match is often in the
 * answer, not the question) and `/faq#{id}` can open the question it names.
 * `onToggle` copies each open/close back, so a press on a summary and the
 * state never disagree.
 */
export default function FaqBrowser({ categories }: { categories: FaqCategory[] }) {
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const shown = filterFaqs(categories, query);
  const matchCount = shown.reduce((n, c) => n + c.items.length, 0);

  // A link to one question opens it. Read after mount, since the server has no
  // hash. A search in progress is cleared, since it may be hiding the question,
  // and the scroll waits for the render that puts the question back.
  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || !categories.some((c) => c.items.some((i) => i.id === id))) return;
      setQuery('');
      setOpenIds((prev) => new Set(prev).add(id));
      setScrollTo(id);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [categories]);

  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(scrollTo)?.scrollIntoView({ block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  const search = (value: string) => {
    setQuery(value);
    const found = filterFaqs(categories, value);
    setOpenIds(
      value.trim() ? new Set(found.flatMap((c) => c.items.map((i) => i.id))) : new Set(),
    );
  };

  const toggled = (id: string, open: boolean) => {
    setOpenIds((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div>
      <label htmlFor="faq-search" className="sr-only">Search the FAQ</label>
      <input
        id="faq-search"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search questions — e.g. back number, Coggins, scratch"
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
      />

      {query.trim() ? (
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }} aria-live="polite">
          {matchCount === 0
            ? 'No questions match.'
            : `${matchCount} question${matchCount === 1 ? '' : 's'} match.`}{' '}
          <button
            type="button"
            onClick={() => search('')}
            className="font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Clear search
          </button>
        </p>
      ) : (
        <nav aria-label="FAQ topics" className="flex flex-wrap gap-2 mt-3">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`#topic-${c.id}`}
              className="text-sm px-3 py-1.5 rounded-full border transition hover:shadow-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--foreground)' }}
            >
              <span aria-hidden="true">{c.icon}</span> {c.title}
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-8 mt-6">
        {shown.map((category) => (
          <section key={category.id} id={`topic-${category.id}`} aria-labelledby={`topic-${category.id}-title`} className="scroll-mt-4">
            <h2 id={`topic-${category.id}-title`} className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
              <span aria-hidden="true">{category.icon}</span>
              {category.title}
            </h2>
            <p className="text-sm mt-0.5 mb-3" style={{ color: 'var(--muted)' }}>{category.blurb}</p>

            <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              {category.items.map((item) => (
                <details
                  key={item.id}
                  id={item.id}
                  open={openIds.has(item.id)}
                  onToggle={(e) => toggled(item.id, e.currentTarget.open)}
                  className="group scroll-mt-4"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <summary
                    className="flex cursor-pointer select-none list-none items-start justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden"
                    style={{ color: 'var(--foreground)' }}
                  >
                    <span>{item.q}</span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 transition-transform group-open:rotate-90"
                      style={{ color: 'var(--accent)' }}
                    >
                      ▸
                    </span>
                  </summary>
                  <div className="px-4 pb-4 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--text-deep)' }}>
                    {item.a.map((block, i) => (
                      <AnswerBlock key={i} block={block} />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AnswerBlock({ block }: { block: FaqBlock }) {
  if (Array.isArray(block)) {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {block.map((text, i) => (
          <li key={i}><AnswerText text={text} /></li>
        ))}
      </ul>
    );
  }
  return <p><AnswerText text={block} /></p>;
}

function AnswerText({ text }: { text: string }) {
  return (
    <>
      {faqSegments(text).map((segment, i) =>
        segment.href ? (
          <Link key={i} href={segment.href} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            {segment.text}
          </Link>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
