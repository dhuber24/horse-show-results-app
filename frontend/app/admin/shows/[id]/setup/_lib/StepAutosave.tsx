'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Saving a step's unfinished work on the way out of it.
 *
 * Every setup step used to end in a Save button, and leaving without pressing
 * it lost whatever had been typed — silently, because moving on through the
 * stepper looks like progress rather than like discarding a form. The wizard is
 * a sequence somebody walks; the press was ceremony that only ever caught
 * people out.
 *
 * So the navigation owns the save. A step's client registers a `flush` — write
 * whatever is unsaved, or do nothing if there is nothing — and every control
 * that leaves the step (`StepNav`'s Back / Next / hub links, and the stepper's
 * own step links) awaits it before navigating.
 *
 * Two rules make this safe to bolt onto forms that already had Save buttons:
 *
 * - **A flush that throws stops the navigation.** The step's own error message
 *   is already on screen at that point, and carrying the manager forward from a
 *   422 would be exactly the silent loss this replaces.
 * - **A flush must be a no-op when nothing is dirty.** These fire on every
 *   press of every step link, so an unconditional PUT would rewrite a step
 *   somebody only passed through.
 *
 * The Save buttons that remain (Lodging, Sanctioning) still work and still say
 * what they did; this is a second door onto the same function, not a
 * replacement for it. Step 4's "Save & continue to Classes" is the one that
 * went — it did nothing the Next link does not now do for itself.
 */

export type StepFlush = () => Promise<void> | void;

type Registry = {
  register: (fn: StepFlush) => () => void;
  flush: () => Promise<void>;
};

const StepAutosaveContext = createContext<Registry | null>(null);

export function StepAutosaveProvider({ children }: { children: React.ReactNode }) {
  const flushes = useRef(new Set<StepFlush>());

  const register = useCallback((fn: StepFlush) => {
    flushes.current.add(fn);
    return () => {
      flushes.current.delete(fn);
    };
  }, []);

  // Sequentially, not in parallel: two of these can write the same `show_fees`
  // row set (the charges editor and a step's own save), and a step that opens
  // with an error should not have fired the rest of its writes first.
  const flush = useCallback(async () => {
    for (const fn of Array.from(flushes.current)) {
      await fn();
    }
  }, []);

  const value = useRef<Registry>({ register, flush });
  value.current = { register, flush };

  return (
    <StepAutosaveContext.Provider value={value.current}>
      {children}
    </StepAutosaveContext.Provider>
  );
}

/**
 * Register this component's unsaved work with the step around it.
 *
 * The callback is read through a ref, so it always sees current state — a
 * registration captured on mount would flush the drafts the form opened with.
 */
export function useRegisterStepAutosave(fn: StepFlush): void {
  const ctx = useContext(StepAutosaveContext);
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(() => latest.current());
  }, [ctx]);
}

/**
 * What a navigation control calls before it leaves.
 *
 * Returns a no-op outside a step — `WizardStepper` also renders on the setup
 * hub, where there is no form to save and nothing registered.
 */
export function useStepAutosaveFlush(): () => Promise<void> {
  const ctx = useContext(StepAutosaveContext);
  return useCallback(async () => {
    if (ctx) await ctx.flush();
  }, [ctx]);
}

/**
 * A link that saves the step before it navigates.
 *
 * A button rather than an anchor: it is not a plain navigation any more, and
 * middle-clicking a step link to open it in a new tab would otherwise leave the
 * work in this one unsaved with no sign of it.
 */
export function AutosaveNavLink({
  href,
  className,
  style,
  children,
  ariaCurrent,
}: {
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  ariaCurrent?: 'step';
}) {
  const flush = useStepAutosaveFlush();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      aria-current={ariaCurrent}
      disabled={busy}
      className={className}
      style={style}
      onClick={async () => {
        setBusy(true);
        try {
          await flush();
        } catch {
          // The step showed its own error. Staying put is the point.
          setBusy(false);
          return;
        }
        // A full load rather than router.push: the flush has just written rows
        // the destination step reads server-side, and a client transition can
        // serve them from the router cache.
        window.location.assign(href);
      }}
    >
      {children}
    </button>
  );
}
