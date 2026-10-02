'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * How a paperwork row the desk still has to act on stands out from the rows
 * that are done.
 *
 * The section's badge said "3 to check" and left staff to find the three among
 * a dozen rows that looked alike — a grey pill reading "Not checked" beside a
 * green one reading "Verified" is a difference you have to read, not see. A red
 * outline round the row itself is what the eye lands on, and every row that has
 * one says in words what to do (`ToDo`), so the outline is never a puzzle.
 *
 * One frame for every kind of row — membership, papers, health, release,
 * emergency contact — so the red box means the same thing wherever it is.
 */
export function rowFrame(needsAction: boolean): { className: string; style: CSSProperties } {
  return needsAction
    ? {
        className: 'my-1.5 rounded-md border-2 px-3 py-2',
        style: { borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)' },
      }
    : {
        className: 'py-2 border-t first:border-t-0',
        style: { borderColor: 'var(--bg-subtle)' },
      };
}

/** The one line inside a red row that says what to do about it. A block
 *  `span` rather than a `p`, because a waiver's lives inside its `<label>`. */
export function ToDo({ children }: { children: ReactNode }) {
  return (
    <span className="block text-xs mt-1 font-semibold" style={{ color: 'var(--error-strong)' }}>
      {children}
    </span>
  );
}
