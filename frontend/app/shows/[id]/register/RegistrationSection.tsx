'use client';

/**
 * One step of the registration wizard, as a collapsible box.
 *
 * Registration is five things — your details, your horses, the grounds, your
 * classes, and any futurity — and it is one screen rather than five routes.
 * That is a deliberate departure from the show-setup wizard it otherwise
 * mirrors: a show manager builds a show over a fortnight from a desk, while an
 * exhibitor enters one in a single sitting on a phone, usually with a bill
 * they want to keep an eye on. Five routes would put a page load between every
 * answer and hide the running total behind all of them.
 *
 * So: a stepper across the top, one box open at a time, and **Back / Next**
 * along the bottom of each — but every box stays on the page, so somebody who
 * wants to check what they reserved four steps ago just opens it.
 *
 * `locked` is a backend rule made visible rather than enforced here. Class
 * entries and back numbers both 409 without a completed sign-up, and `PUT
 * /signup` refuses over a short profile. The lock exists so nobody fills in a
 * form that is going to be turned away, never as the thing turning it away —
 * an API client walks straight past it.
 */

export default function RegistrationSection({
  step,
  title,
  summary,
  icon,
  isOpen,
  onToggle,
  locked,
  lockedReason,
  done,
  onBack,
  onNext,
  nextLabel,
  nextDisabledReason,
  footerNote,
  children,
}: {
  /** Position in the flow, shown in the header so the box and the stepper
   *  above it agree about which number this is. */
  step: number;
  title: string;
  /** What you have, for reading with the section shut. */
  summary: string;
  icon: string;
  isOpen: boolean;
  onToggle: () => void;
  locked?: boolean;
  lockedReason?: string;
  /** Whether this step is finished — a tick beside the header, matching the
   *  stepper's badge. */
  done?: boolean;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  /** Set when Next cannot be pressed yet. Renders as the button's `title` and
   *  as a line under it, because a disabled button with only a tooltip is
   *  unreadable on the phone most of this is filled in on. */
  nextDisabledReason?: string | null;
  /** Anything to sit beside the navigation — the classes step's way out to My
   *  Shows, for somebody coming back to enter classes another day. */
  footerNote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const open = isOpen && !locked;

  return (
    <section
      className="mt-4 rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
        title={
          locked ? lockedReason : open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`
        }
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
        style={{ backgroundColor: open ? 'var(--background)' : 'var(--surface)' }}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold"
            style={{
              backgroundColor: done ? 'var(--success)' : locked ? 'var(--border-subtle)' : 'var(--text-deep)',
              color: done || !locked ? 'var(--surface)' : 'var(--text-dimmed)',
            }}
          >
            {done ? '✓' : step}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold" style={{ color: locked ? 'var(--text-dimmed)' : 'var(--foreground)' }}>
              <span aria-hidden="true" className="mr-1.5">
                {icon}
              </span>
              {title}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {locked ? lockedReason : summary}
            </span>
          </span>
        </span>
        {!locked && (
          <span
            className="text-sm shrink-0 transition-transform"
            aria-hidden="true"
            style={{ color: 'var(--accent)', transform: open ? 'rotate(90deg)' : 'none' }}
          >
            ▶
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
          {children}

          {(onBack || onNext || footerNote) && (
            <div
              className="mt-4 pt-3 border-t flex flex-wrap items-center gap-3"
              style={{ borderColor: 'var(--bg-subtle)' }}
            >
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-sm rounded px-3 py-2 border"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
                >
                  ← Back
                </button>
              ) : (
                <span />
              )}
              {footerNote}
              {onNext && (
                <span className="ml-auto flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={Boolean(nextDisabledReason)}
                    title={nextDisabledReason ?? undefined}
                    className="text-sm rounded px-4 py-2 font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--text-deep)' }}
                  >
                    {nextLabel ?? 'Next'} →
                  </button>
                  {nextDisabledReason && (
                    <span className="text-xs text-right" style={{ color: 'var(--warning)' }}>
                      {nextDisabledReason}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
