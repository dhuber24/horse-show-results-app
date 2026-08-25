// Globals are imported rather than declared ambiently: `tsconfig.json` includes
// `**/*.ts`, so these files are type-checked by `npm run type-check`, and
// importing from `@jest/globals` keeps that passing without adding
// `@types/jest` to the dependency tree.
import { describe, expect, it } from '@jest/globals';

import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('passes a same-origin absolute path straight through', () => {
    expect(safeNextPath('/shows/abc/signup')).toBe('/shows/abc/signup');
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/shows/abc?tab=fees#stalls')).toBe('/shows/abc?tab=fees#stalls');
  });

  it('rejects a protocol-relative path', () => {
    // Browsers read `//host` as "somewhere else entirely", which is exactly
    // what an open redirect is.
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('//evil.com/shows')).toBeNull();
  });

  it('rejects the backslash spelling of protocol-relative', () => {
    expect(safeNextPath('/\\evil.com')).toBeNull();
  });

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('http://evil.com')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects a relative path', () => {
    // Nothing calls this with a relative path today, and resolving one depends
    // on the page it is used from — so it is refused rather than guessed at.
    expect(safeNextPath('shows/abc')).toBeNull();
  });

  it('treats nothing at all as nothing to redirect to', () => {
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it('does not decode percent-encoding before checking', () => {
    // Documents a deliberate limit rather than a gap: the value is handed to
    // Next's router as a path, which does not decode `%2F%2F` into a
    // protocol-relative prefix. Pinned so a future change here is a decision.
    expect(safeNextPath('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
  });
});
