// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { activeNavHref } from './active-nav';

const base = '/admin/shows/abc';
const hrefs = [`${base}/setup`, `${base}/classes`, `${base}/classes/judging`, `${base}/desk`, `${base}/fees`];

describe('activeNavHref', () => {
  it('matches the page itself', () => {
    expect(activeNavHref(`${base}/desk`, hrefs)).toBe(`${base}/desk`);
  });

  it('matches a page under a link', () => {
    expect(activeNavHref(`${base}/desk/paperwork`, hrefs)).toBe(`${base}/desk`);
  });

  it('prefers the most specific link', () => {
    expect(activeNavHref(`${base}/classes/judging`, hrefs)).toBe(`${base}/classes/judging`);
    expect(activeNavHref(`${base}/classes/123`, hrefs)).toBe(`${base}/classes`);
  });

  it('matches whole segments only', () => {
    expect(activeNavHref(`${base}/feesreport`, hrefs)).toBeNull();
  });

  it('ignores a trailing slash', () => {
    expect(activeNavHref(`${base}/desk/`, hrefs)).toBe(`${base}/desk`);
  });

  it('is null for a page the menu does not list', () => {
    expect(activeNavHref(`${base}/staff`, hrefs)).toBeNull();
  });
});
