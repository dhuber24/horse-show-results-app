'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  actionHref,
  checkAnchorId,
  checksAbout,
  isOpen,
  sourceLabel,
  type BillCheck,
  type BillCheckAction,
  type BillCheckTarget,
} from '@/lib/bill-checks';
import type { WizardStepKey } from '@/app/admin/shows/_wizard/WizardStepper';

/**
 * The show-bill checks on a setup step (migration 187): the list at the top of
 * the step, and the highlight on each field a check is about.
 *
 * `StepLayout` holds the provider for every step, with the show's checks read
 * server-side by `fetchStepCounts`. A step's own form marks a field with
 * `<BillCheckField>` (or a row with `<BillCheckRow>`) and that is all it does:
 * the list, the counts and the Accept press live here.
 *
 * Accepting refreshes the route, which recounts the tab bar and the sidebar.
 * The list here moves at once rather than waiting for that, because somebody
 * working down twenty checks should not watch each one hang.
 */

type Handler = (check: BillCheck) => void;

type Ctx = {
  showId: string;
  checks: BillCheck[];
  accept: (id: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  /** A step's form says it can carry out an action — fill in its new-judge
   *  form, say. The list offers an action only where a handler is registered,
   *  or where it is a plain link. */
  registerAction: (kind: BillCheckAction['kind'], fn: Handler) => () => void;
  handlerFor: (kind: BillCheckAction['kind']) => Handler | undefined;
  /** Bumped when a handler registers, so the list re-reads which exist. */
  handlersVersion: number;
  error: string | null;
};

const BillChecksContext = createContext<Ctx | null>(null);

export function BillChecksProvider({
  showId,
  initial,
  children,
}: {
  showId: string;
  initial: BillCheck[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checks, setChecks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef(new Map<string, Handler>());
  const [handlersVersion, setHandlersVersion] = useState(0);

  // A refresh brings the backend's states back — `changed` once a field has
  // been saved with a new value, say — so take them whenever they arrive.
  useEffect(() => setChecks(initial), [initial]);

  const press = useCallback(
    async (id: string, accepted: boolean) => {
      setError(null);
      const before = checks;
      setChecks((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, state: accepted ? 'accepted' : 'open', accepted_at: accepted ? new Date().toISOString() : null }
            : c,
        ),
      );
      try {
        const res = await fetch(`/api/shows/${showId}/bill-checks/${id}/accepted`, {
          method: accepted ? 'PUT' : 'DELETE',
        });
        if (!res.ok) throw new Error();
        router.refresh();
      } catch {
        setChecks(before);
        setError(accepted ? 'That check could not be accepted. Try again.' : 'That check could not be reopened.');
      }
    },
    [checks, router, showId],
  );

  const registerAction = useCallback((kind: BillCheckAction['kind'], fn: Handler) => {
    handlers.current.set(kind, fn);
    setHandlersVersion((v) => v + 1);
    return () => {
      if (handlers.current.get(kind) === fn) handlers.current.delete(kind);
      setHandlersVersion((v) => v + 1);
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      showId,
      checks,
      accept: (id) => press(id, true),
      reopen: (id) => press(id, false),
      registerAction,
      handlerFor: (kind) => handlers.current.get(kind),
      handlersVersion,
      error,
    }),
    [showId, checks, press, registerAction, handlersVersion, error],
  );

  return <BillChecksContext.Provider value={value}>{children}</BillChecksContext.Provider>;
}

/** The checks around this component, or none outside a setup step. */
export function useBillChecks(): Ctx | null {
  return useContext(BillChecksContext);
}

/**
 * Let the step's list carry out an action through this form — the Judges step
 * filling its new-judge form with the name the bill printed, for instance.
 * The handler is read through a ref, so it always sees the form's current state.
 */
export function useBillCheckAction(kind: BillCheckAction['kind'], fn: Handler): void {
  const ctx = useBillChecks();
  const latest = useRef(fn);
  latest.current = fn;
  const register = ctx?.registerAction;
  useEffect(() => {
    if (!register) return;
    return register(kind, (check) => latest.current(check));
  }, [register, kind]);
}

// ── On the field ────────────────────────────────────────────────────────────

const WARN = {
  border: 'var(--warning-border)',
  bg: 'var(--warning-bg)',
  strong: 'var(--warning-strong)',
  text: 'var(--foreground)',
} as const;

/**
 * A field with something read off the show bill to check: outlined, with the
 * doubt and an Accept beneath it. Renders its children untouched when there is
 * nothing open — which is every field of a show not set up from its bill.
 *
 * `field` is a column name (`start_date`) or several (`['apha_show_number',
 * 'aqha_show_number']`); left out, every check on the record shows.
 */
export function BillCheckField({
  target,
  id,
  field,
  children,
  className = '',
}: {
  target: BillCheckTarget;
  id?: string | null;
  field?: string | readonly string[];
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useBillChecks();
  const open = ctx ? checksAbout(ctx.checks, target, id, field).filter(isOpen) : [];
  if (open.length === 0) return <>{children}</>;
  return (
    <div
      data-bill-check-field
      className={`rounded-md border-2 p-2 space-y-2 ${className}`}
      style={{ borderColor: WARN.border, backgroundColor: WARN.bg }}
    >
      {children}
      <div className="space-y-1.5">
        {open.map((c) => (
          <InlineCheck key={c.id} check={c} />
        ))}
      </div>
    </div>
  );
}

/**
 * The same, for a row in a table: a cell that spans the row, under it. Returns
 * null when nothing is open, so a table can render it unconditionally.
 */
export function BillCheckRow({
  target,
  id,
  colSpan,
}: {
  target: BillCheckTarget;
  id: string;
  colSpan: number;
}) {
  const ctx = useBillChecks();
  const open = ctx ? checksAbout(ctx.checks, target, id).filter(isOpen) : [];
  if (open.length === 0) return null;
  return (
    <tr style={{ backgroundColor: WARN.bg }}>
      <td colSpan={colSpan} className="px-2 pb-2 pt-1 space-y-1.5">
        {open.map((c) => (
          <InlineCheck key={c.id} check={c} />
        ))}
      </td>
    </tr>
  );
}

/**
 * The open checks on a record, as a box of their own — for a card, where
 * wrapping the whole card in an outline would bury its own layout. Null when
 * nothing is open.
 */
export function BillCheckNotes({
  target,
  id,
  field,
  className = '',
}: {
  target: BillCheckTarget;
  id: string | null | undefined;
  field?: string | readonly string[];
  className?: string;
}) {
  const ctx = useBillChecks();
  if (!id && target !== 'show') return null;
  const open = ctx ? checksAbout(ctx.checks, target, id, field).filter(isOpen) : [];
  if (open.length === 0) return null;
  return (
    <div
      data-bill-check-field
      className={`rounded-md border-2 p-2 space-y-1.5 ${className}`}
      style={{ borderColor: WARN.border, backgroundColor: WARN.bg }}
    >
      {open.map((c) => (
        <InlineCheck key={c.id} check={c} />
      ))}
    </div>
  );
}

/** Whether a record has an open check — for a row that wants its own outline. */
export function useHasOpenCheck(target: BillCheckTarget, id: string | null | undefined, field?: string): boolean {
  const ctx = useBillChecks();
  return ctx ? checksAbout(ctx.checks, target, id, field).some(isOpen) : false;
}

/** The style a row with an open check takes: an outline in the warning colour. */
export const OPEN_CHECK_STYLE: React.CSSProperties = {
  boxShadow: `inset 3px 0 0 ${WARN.strong}`,
  backgroundColor: WARN.bg,
};

function InlineCheck({ check }: { check: BillCheck }) {
  const ctx = useBillChecks();
  return (
    <div
      id={checkAnchorId(check.id)}
      className="flex items-start gap-2 text-xs scroll-mt-24"
      style={{ color: WARN.text }}
    >
      <span aria-hidden className="font-bold" style={{ color: WARN.strong }}>
        !
      </span>
      <span className="flex-1 min-w-0">
        <span className="sr-only">{sourceLabel(check)}: </span>
        {check.message}
      </span>
      <AcceptButton onPress={() => ctx?.accept(check.id)} />
    </div>
  );
}

function AcceptButton({ onPress, label = 'Accept' }: { onPress: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="shrink-0 text-xs rounded border px-2 py-0.5 font-medium"
      style={{ borderColor: WARN.strong, color: WARN.strong, backgroundColor: 'var(--surface)' }}
      title="It is right as it stands"
    >
      {label}
    </button>
  );
}

// ── The step's list ─────────────────────────────────────────────────────────

/**
 * Everything read off the show bill to check on this step, above the step's
 * own form.
 *
 * Every check is here, whether or not the form draws its field: a check about
 * a judge the bill named but the registry lacks has no field, and one about a
 * tack stall is edited on another screen. Where the field *is* drawn, *Show
 * me* scrolls to it. Answered checks fold into a line at the bottom, each with
 * an undo, since an Accept pressed by mistake would otherwise be invisible.
 */
export function StepBillChecks({ step }: { step: WizardStepKey }) {
  const ctx = useBillChecks();
  const [showDone, setShowDone] = useState(false);
  // Which open checks have their field on this page — known only once it has
  // rendered, so read after mount and whenever the list changes.
  const [onPage, setOnPage] = useState<Set<string>>(new Set());
  const mine = useMemo(() => (ctx ? ctx.checks.filter((c) => c.step === step) : []), [ctx, step]);
  const open = mine.filter(isOpen);
  const done = mine.filter((c) => !isOpen(c));

  useEffect(() => {
    const ids = new Set<string>();
    for (const c of open) if (document.getElementById(checkAnchorId(c.id))) ids.add(c.id);
    setOnPage(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is derived from `mine`
  }, [mine]);

  if (!ctx || mine.length === 0) return null;

  return (
    <section
      aria-label="Read off the show bill"
      className="rounded-lg border p-4 space-y-3"
      style={{
        borderColor: open.length ? WARN.border : 'var(--success-border)',
        backgroundColor: open.length ? WARN.bg : 'var(--success-bg)',
      }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          {open.length
            ? `${open.length} thing${open.length === 1 ? '' : 's'} read off the show bill to check`
            : 'Everything read off the show bill here is checked'}
        </h2>
        {open.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Accept each one if it is right, or change what it is about (changing it counts as checked).
            The show can&apos;t be published until every step&apos;s list is clear.
          </p>
        )}
      </div>

      {ctx.error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
          {ctx.error}
        </p>
      )}

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((c) => (
            <li
              key={c.id}
              className="rounded border p-2.5 text-sm flex flex-wrap items-start gap-x-3 gap-y-2"
              style={{ borderColor: WARN.border, backgroundColor: 'var(--surface)' }}
            >
              <div className="flex-1 min-w-[14rem]">
                <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: WARN.strong }}>
                  {sourceLabel(c)}
                </div>
                <div style={{ color: 'var(--foreground)' }}>{c.message}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {onPage.has(c.id) && (
                  <button
                    type="button"
                    className="text-xs underline"
                    style={{ color: 'var(--primary)' }}
                    onClick={() => {
                      const el = document.getElementById(checkAnchorId(c.id));
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const box = el?.closest<HTMLElement>('[data-bill-check-field]') ?? el;
                      box?.animate?.(
                        [{ outline: `3px solid ${WARN.strong}` }, { outline: '3px solid transparent' }],
                        { duration: 1200 },
                      );
                    }}
                  >
                    Show me
                  </button>
                )}
                <ActionButton check={c} />
                <AcceptButton onPress={() => ctx.accept(c.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="text-xs">
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--muted)' }}
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? 'Hide' : 'Show'} {done.length} checked
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1.5">
              {done.map((c) => (
                <li key={c.id} className="flex items-start gap-2" style={{ color: 'var(--muted)' }}>
                  <span aria-hidden>✓</span>
                  <span className="flex-1">
                    {c.message}{' '}
                    <em>
                      {c.state === 'accepted'
                        ? '— accepted'
                        : c.state === 'changed'
                          ? '— changed since the read'
                          : '— removed since the read'}
                    </em>
                  </span>
                  {c.state === 'accepted' && (
                    <button
                      type="button"
                      className="underline shrink-0"
                      style={{ color: 'var(--primary)' }}
                      onClick={() => ctx.reopen(c.id)}
                    >
                      Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ActionButton({ check }: { check: BillCheck }) {
  const ctx = useBillChecks();
  if (!ctx || !check.action) return null;
  const action = check.action;
  if (action.kind === 'link') {
    // A plain anchor: the unsaved-changes guard asks before it leaves a step
    // with typed work on it, the same as any other link off the page.
    return (
      <a href={actionHref(ctx.showId, action)} className="text-xs underline" style={{ color: 'var(--primary)' }}>
        {action.label} →
      </a>
    );
  }
  const handler = ctx.handlerFor(action.kind);
  if (!handler) return null;
  const label =
    action.kind === 'add_judge'
      ? action.candidate_ids.length
        ? `Pick or add ${action.first_name} ${action.last_name}`
        : `Add ${action.first_name} ${action.last_name}`
      : `Add ${action.name ?? 'this venue'}`;
  return (
    <button
      type="button"
      onClick={() => handler(check)}
      className="text-xs rounded border px-2 py-0.5"
      style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
    >
      {label}
    </button>
  );
}
