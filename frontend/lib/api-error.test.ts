// Globals are imported rather than declared ambiently: `tsconfig.json` includes
// `**/*.ts`, so these files are type-checked by `npm run type-check`, and
// importing from `@jest/globals` keeps that passing without adding
// `@types/jest` to the dependency tree.
import { describe, expect, it } from '@jest/globals';

import { errorMessage } from './api-error';

describe('errorMessage', () => {
  it('passes an HTTPException string straight through', () => {
    expect(
      errorMessage({ detail: 'Class date must be between 2027-01-08 and 2027-01-10' }, 'fallback'),
    ).toBe('Class date must be between 2027-01-08 and 2027-01-10');
  });

  it('reads the message out of a Pydantic validation list', () => {
    // The exact body `PATCH /shows/{id}` returns when the dates are reversed.
    // Rendering this object was what crashed the Basics step.
    const body = {
      detail: [
        {
          type: 'value_error',
          loc: ['body'],
          msg: 'Value error, The end date must be on or after the start date.',
          input: { start_date: '2027-02-08', end_date: '2027-01-10' },
          ctx: { error: {} },
        },
      ],
    };
    expect(errorMessage(body, 'Failed to update show.')).toBe(
      'The end date must be on or after the start date.',
    );
  });

  it('names the field when the error is about one', () => {
    const body = {
      detail: [{ type: 'string_too_long', loc: ['body', 'name'], msg: 'String should have at most 200 characters' }],
    };
    expect(errorMessage(body, 'fallback')).toBe('name: String should have at most 200 characters');
  });

  it('joins several validation errors and drops repeats', () => {
    const body = {
      detail: [
        { loc: ['body', 'apha_zone'], msg: 'Input should be less than or equal to 14' },
        { loc: ['body', 'name'], msg: 'Field required' },
        { loc: ['body', 'apha_zone'], msg: 'Input should be less than or equal to 14' },
      ],
    };
    expect(errorMessage(body, 'fallback')).toBe(
      'apha_zone: Input should be less than or equal to 14; name: Field required',
    );
  });

  it('falls back rather than returning anything unrenderable', () => {
    // Every one of these used to reach React as-is.
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage({}, 'fallback')).toBe('fallback');
    expect(errorMessage({ detail: [] }, 'fallback')).toBe('fallback');
    expect(errorMessage({ detail: [{ loc: ['body'] }] }, 'fallback')).toBe('fallback');
    expect(errorMessage({ detail: '   ' }, 'fallback')).toBe('fallback');
    expect(errorMessage('a bare string', 'fallback')).toBe('fallback');
  });

  it('reads a Next route handler’s own error shape', () => {
    // `/api/...` answers an unauthenticated call itself; it never reaches the
    // backend to be given a `detail`.
    expect(errorMessage({ error: 'Unauthorized' }, 'fallback')).toBe('Unauthorized');
  });

  it('prefers detail over error when both are present', () => {
    expect(errorMessage({ detail: 'Not authorized for this show', error: 'Forbidden' }, 'x')).toBe(
      'Not authorized for this show',
    );
  });
});
