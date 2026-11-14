'use client';

import { useEffect, useRef } from 'react';

export type LeaveChoice = 'stay' | 'discard' | 'save';

/**
 * Asked before somebody leaves a page with unsaved work on it (`StepAutosave`).
 *
 * **Stay is the default** — focused on open, and what Escape and a press on the
 * backdrop mean — because the one answer that cannot be taken back is losing
 * the work. Leaving without saving is said in as many words, in the danger
 * colour. *Save and leave* is offered only where every unsaved form on the
 * page can save itself; Step 1's form, which has its own Save button, cannot.
 */
export default function UnsavedChangesDialog({
  savable,
  onChoose,
}: {
  savable: boolean;
  onChoose: (choice: LeaveChoice) => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onChoose('stay');
      }
      // Keep Tab inside the dialog while it is open.
      if (event.key === 'Tab' && dialogRef.current) {
        const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onChoose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onChoose('stay');
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        className="w-full max-w-md rounded-lg border p-5 space-y-4 shadow-xl"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="space-y-1.5">
          <h2 id="unsaved-changes-title" className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            You have unsaved changes
          </h2>
          <p id="unsaved-changes-body" className="text-sm" style={{ color: 'var(--muted)' }}>
            {savable
              ? 'What you typed on this page has not been saved yet. Save it before you go, or leave and lose it.'
              : 'What you typed on this page has not been saved. If you leave now, it will be lost.'}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onChoose('discard')}
            className="text-sm rounded px-3 py-2 border"
            style={{ borderColor: 'var(--error)', color: 'var(--error-strong)', backgroundColor: 'var(--surface)' }}
          >
            Leave without saving
          </button>
          {savable && (
            <button
              type="button"
              onClick={() => onChoose('save')}
              className="text-sm rounded px-3 py-2 border"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
            >
              Save and leave
            </button>
          )}
          <button
            ref={stayRef}
            type="button"
            onClick={() => onChoose('stay')}
            className="text-sm rounded px-4 py-2"
            style={{ backgroundColor: 'var(--text-deep)', color: 'var(--surface)' }}
          >
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}
