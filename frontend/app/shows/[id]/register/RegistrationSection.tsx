'use client';

/**
 * One foldable half of the registration screen.
 *
 * The screen now carries everything an exhibitor signs up for — back number,
 * classes, health paperwork, stalls, shavings and camping — and all of it open
 * at once is a very long page on the phone most people fill this in on. Folded,
 * each half is a header you can read at a glance, so the summary line is doing
 * real work: collapsed, it is the only thing saying what you have.
 *
 * `locked` is the sign-up rule made visible rather than enforced after the
 * fact. Class entries and back numbers both need a completed sign-up and 409
 * without one, so before that the classes half does not open — and says which
 * section to fill in instead, since "you can't do this yet" without a
 * destination is the kind of message people read as a fault.
 */
export default function RegistrationSection({
  title,
  summary,
  icon,
  isOpen,
  onToggle,
  locked,
  lockedReason,
  children,
}: {
  title: string;
  /** What you have, for reading with the section shut. */
  summary: string;
  icon: string;
  isOpen: boolean;
  onToggle: () => void;
  locked?: boolean;
  lockedReason?: string;
  children: React.ReactNode;
}) {
  const open = isOpen && !locked;

  return (
    <section
      className="mt-4 rounded-lg border overflow-hidden"
      style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
        title={locked ? lockedReason : open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
        style={{ backgroundColor: open ? '#faf4ec' : '#ffffff' }}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden="true">{icon}</span>
          <span className="min-w-0">
            <span className="block font-semibold" style={{ color: locked ? '#a08a6e' : '#2c1810' }}>
              {title}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: '#8b7355' }}>
              {locked ? lockedReason : summary}
            </span>
          </span>
        </span>
        {!locked && (
          <span
            className="text-sm shrink-0 transition-transform"
            aria-hidden="true"
            style={{ color: '#8b4513', transform: open ? 'rotate(90deg)' : 'none' }}
          >
            ▶
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: '#f0e4d0' }}>
          {children}
        </div>
      )}
    </section>
  );
}
