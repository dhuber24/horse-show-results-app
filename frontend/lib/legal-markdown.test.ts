import { describe, expect, it } from '@jest/globals';

import { legalInline, legalSlug, parseLegalMarkdown } from './legal-markdown';
import { PRIVACY_MARKDOWN } from './legal/privacy';
import { TERMS_MARKDOWN } from './legal/terms';

describe('legalInline', () => {
  it('splits bold runs and links out of plain text', () => {
    expect(legalInline('**Privacy.** See [the policy](/privacy) for more.')).toEqual([
      { text: 'Privacy.', bold: true },
      { text: ' See ' },
      { text: 'the policy', href: '/privacy' },
      { text: ' for more.' },
    ]);
  });

  it('drops the backslash a Docs export puts before a literal bracket or underscore', () => {
    expect(legalInline('cookies (\\_ga) and \\[brackets\\]')).toEqual([{ text: 'cookies (_ga) and [brackets]' }]);
  });
});

describe('legalSlug', () => {
  it('keeps the section number so anchors stay unique', () => {
    expect(legalSlug('7. Fees, invoicing and payment')).toBe('7-fees-invoicing-and-payment');
  });
});

describe('parseLegalMarkdown', () => {
  it('reads headings, paragraphs, lists and tables', () => {
    const blocks = parseLegalMarkdown(
      [
        '# Part A',
        '',
        '## 1. About',
        '',
        'First line',
        'carries on.',
        '',
        '- one',
        '- **two**',
        '',
        '| Plan | Price |',
        '| --- | --- |',
        '| Basic | $2 |',
      ].join('\n'),
    );

    expect(blocks).toEqual([
      { kind: 'part', text: 'Part A' },
      { kind: 'section', text: '1. About', id: '1-about' },
      { kind: 'paragraph', inline: [{ text: 'First line carries on.' }] },
      { kind: 'list', items: [[{ text: 'one' }], [{ text: 'two', bold: true }]] },
      {
        kind: 'table',
        header: [[{ text: 'Plan' }], [{ text: 'Price' }]],
        rows: [[[{ text: 'Basic' }], [{ text: '$2' }]]],
      },
    ]);
  });
});

// The published text must not carry anything meant only for the draft.
describe.each([
  ['Terms of Service', TERMS_MARKDOWN],
  ['Privacy Policy', PRIVACY_MARKDOWN],
])('%s', (_name, markdown) => {
  it('has no placeholder left to fill', () => {
    expect(markdown).not.toMatch(/\[[A-Z][A-Za-z ]+\](?!\()/);
  });

  it('has no drafting note', () => {
    expect(markdown.toLowerCase()).not.toContain('drafting note');
  });

  it('gives every section a different anchor', () => {
    const ids = parseLegalMarkdown(markdown)
      .filter((block) => block.kind === 'section')
      .map((block) => (block as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);
  });

  it('links only to this site or to https pages', () => {
    const hrefs = parseLegalMarkdown(markdown).flatMap((block) => {
      const runs =
        block.kind === 'paragraph'
          ? block.inline
          : block.kind === 'list'
            ? block.items.flat()
            : block.kind === 'table'
              ? [...block.header.flat(), ...block.rows.flat(2)]
              : [];
      return runs.flatMap((run) => (run.href ? [run.href] : []));
    });
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^(\/[a-z]|https:\/\/)/);
  });
});
