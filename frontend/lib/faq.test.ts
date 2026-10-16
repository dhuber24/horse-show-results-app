// Globals are imported rather than declared ambiently: see api-error.test.ts.
import { describe, expect, it } from '@jest/globals';

import { FAQ_CATEGORIES, faqPlainText, faqSegments, filterFaqs, type FaqCategory } from './faq';

const allItems = FAQ_CATEGORIES.flatMap((c) => c.items);
const allText = allItems.flatMap((i) => i.a.flatMap((b) => (Array.isArray(b) ? b : [b])));

describe('FAQ content', () => {
  it('gives every question and topic a unique anchor', () => {
    const ids = [...FAQ_CATEGORIES.map((c) => `topic-${c.id}`), ...allItems.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses anchors that work in a URL fragment as written', () => {
    for (const item of allItems) expect(item.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('answers every question', () => {
    for (const item of allItems) {
      expect(item.q.trim()).not.toBe('');
      expect(faqPlainText(item.a).trim()).not.toBe('');
    }
  });

  // An answer links only to a page of this site. A `//host` path is another
  // site, and the page renders these through next/link without a second look.
  it('links only to same-site paths', () => {
    const hrefs = allText.flatMap((t) => faqSegments(t).flatMap((s) => (s.href ? [s.href] : [])));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^\/(?!\/)/);
  });

  it('leaves no half-written link markup behind', () => {
    for (const text of allText) {
      const plain = faqSegments(text).filter((s) => !s.href).map((s) => s.text).join('');
      expect(plain).not.toMatch(/\]\(/);
    }
  });
});

describe('faqSegments', () => {
  it('splits text around a link', () => {
    expect(faqSegments('Start from the [home page](/) today.')).toEqual([
      { text: 'Start from the ' },
      { text: 'home page', href: '/' },
      { text: ' today.' },
    ]);
  });

  it('handles links at both ends and back to back', () => {
    expect(faqSegments('[a](/a)[b](/b)')).toEqual([
      { text: 'a', href: '/a' },
      { text: 'b', href: '/b' },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(faqSegments('No links here.')).toEqual([{ text: 'No links here.' }]);
  });
});

describe('faqPlainText', () => {
  it('drops link markup and flattens lists', () => {
    expect(faqPlainText(['See [My Account](/profile).', ['one', 'two']])).toBe('See My Account. one two');
  });
});

describe('filterFaqs', () => {
  const categories: FaqCategory[] = [
    {
      id: 'a',
      title: 'Exhibitors',
      icon: '',
      blurb: '',
      items: [
        { id: 'num', q: 'How do I get a back number?', a: ['Ask on the class page.'] },
        { id: 'pay', q: 'How do I pay?', a: ['See [What I Owe](/x).'] },
      ],
    },
    {
      id: 'b',
      title: 'Spectators',
      icon: '',
      blurb: '',
      items: [{ id: 'res', q: 'Where are results?', a: ['On the Results page.'] }],
    },
  ];

  it('returns everything for an empty query', () => {
    expect(filterFaqs(categories, '   ')).toBe(categories);
  });

  it('matches answers as well as questions, ignoring case', () => {
    const found = filterFaqs(categories, 'WHAT i owe');
    expect(found.map((c) => c.items.map((i) => i.id))).toEqual([['pay']]);
  });

  it('needs every word to match, and drops emptied topics', () => {
    expect(filterFaqs(categories, 'back number').map((c) => c.id)).toEqual(['a']);
    expect(filterFaqs(categories, 'back results')).toEqual([]);
  });

  it('matches on the topic title', () => {
    expect(filterFaqs(categories, 'spectators').flatMap((c) => c.items.map((i) => i.id))).toEqual(['res']);
  });
});
