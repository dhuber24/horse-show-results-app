// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import {
  classEntryText,
  formatDeadline,
  registrationAnswered,
  signupClosedText,
  signupDeadlineText,
} from './registration-window';

describe('registrationAnswered', () => {
  it('needs both answers', () => {
    expect(registrationAnswered({ entry_deadline: '2026-10-01', self_entry_closes: 'show_start' })).toBe(true);
    expect(registrationAnswered({ entry_deadline: '2026-10-01', self_entry_closes: null })).toBe(false);
    expect(registrationAnswered({ entry_deadline: null, self_entry_closes: 'class_start' })).toBe(false);
    expect(registrationAnswered({})).toBe(false);
  });
});

describe('the sentences', () => {
  it('reads the deadline as a calendar day, whatever the time zone', () => {
    expect(formatDeadline('2026-10-01')).toBe('Thu, Oct 1');
  });

  it('states the sign-up deadline only when there is one', () => {
    expect(signupDeadlineText('2026-10-01')).toBe('Sign up online by Thu, Oct 1.');
    expect(signupDeadlineText(null)).toBeNull();
  });

  it('reads an unanswered class rule as until each class starts', () => {
    expect(classEntryText('show_start')).toMatch(/until the show starts/);
    expect(classEntryText('class_start')).toMatch(/until each class starts/);
    expect(classEntryText(null)).toMatch(/until each class starts/);
  });

  it('says when sign-up closed', () => {
    expect(signupClosedText('2026-10-01')).toBe('Online sign-up closed after Thu, Oct 1.');
    expect(signupClosedText(null)).toBe('Online sign-up has closed.');
  });
});
