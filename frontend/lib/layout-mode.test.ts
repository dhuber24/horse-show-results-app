// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import { canUseDesktopLayout, layoutFor } from './layout-mode';

describe('canUseDesktopLayout', () => {
  it('is the three office roles', () => {
    expect(canUseDesktopLayout('ADMIN')).toBe(true);
    expect(canUseDesktopLayout('SHOW_MANAGER')).toBe(true);
    expect(canUseDesktopLayout('SHOW_SECRETARY')).toBe(true);
  });

  it('is nobody else, and nobody signed out', () => {
    for (const role of ['EXHIBITOR', 'TRAINER', 'SCRIBE', 'GATE_STEWARD', 'JUDGE', '', null, undefined]) {
      expect(canUseDesktopLayout(role)).toBe(false);
    }
  });
});

describe('layoutFor', () => {
  it('starts the office roles on desktop', () => {
    expect(layoutFor('SHOW_SECRETARY', undefined)).toBe('desktop');
    expect(layoutFor('ADMIN', 'nonsense')).toBe('desktop');
  });

  it('keeps an office browser on mobile once it chose mobile', () => {
    expect(layoutFor('SHOW_MANAGER', 'mobile')).toBe('mobile');
  });

  it('is always mobile for everybody else, cookie or not', () => {
    expect(layoutFor('EXHIBITOR', 'desktop')).toBe('mobile');
    expect(layoutFor('SCRIBE', undefined)).toBe('mobile');
    expect(layoutFor(undefined, undefined)).toBe('mobile');
  });
});
