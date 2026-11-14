'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import UnsavedChangesDialog, { type LeaveChoice } from './UnsavedChangesDialog';

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
 * replacement for it. The fees step's "Save & continue to Classes" is the one that
 * went — it did nothing the Next link does not now do for itself.
 *
 * **Every other way off the page asks first** (the unsaved-changes guard). A
 * form registers whether it holds unsaved work (`isDirty`), and while any does,
 * leaving by a route the step's own navigation does not own — a breadcrumb,
 * the Navbar, a link in the page, the browser's Back or Forward — opens a
 * dialog: stay, leave and lose what was typed, or (where every unsaved form can
 * save itself) save and leave. Reloading, closing the tab or typing an address
 * gets the browser's own prompt, the only one a browser allows there. And a
 * form with no `flush` of its own (Step 1's, which has its Save button) is
 * asked about by the step's own Back / Next and tabs too, since they cannot
 * save it for it.
 */

export type StepFlush = () => Promise<void> | void;

/** Whether a form has typed work that leaving now would lose. Read on demand,
 *  through a ref, so it always sees the form's current state. */
export type StepDirty = () => boolean;

type Entry = { flush?: StepFlush; isDirty?: StepDirty };

/** Thrown by `flush` when somebody chose to stay rather than lose their work —
 *  caught by every navigation control as "stay put", like a failed save. */
export class StayOnStep extends Error {
  constructor() {
    super('Stayed on the step to keep unsaved changes.');
  }
}

type Registry = {
  register: (entry: Entry) => () => void;
  /** Save what can be saved; ask about what cannot. Throws to stay. True when
   *  anything was registered — when there was a step to save. */
  flush: () => Promise<boolean>;
};

const StepAutosaveContext = createContext<Registry | null>(null);

/**
 * The registry. The root layout (`app/layout.tsx`) holds one around the Navbar,
 * the staff sidebar and the page, so the sidebar's links (and the layout
 * toggle) save a step the same way its own tabs do. `StepLayout` asks for one
 * too, and that request **joins
 * the layout's** rather than starting a second: a step
 * registering with an inner registry would be invisible to the sidebar, which
 * would then navigate away from unsaved work — the loss this file exists to stop.
 */
export function StepAutosaveProvider({ children }: { children: React.ReactNode }) {
  const outer = useContext(StepAutosaveContext);
  const entries = useRef(new Set<Entry>());
  // Set once somebody has answered "leave": the navigation that follows must
  // not be asked about again — by the browser's prompt on the way out, above
  // all, which would otherwise fire on a page whose state has not caught up
  // with the save it just made.
  const leaving = useRef(false);
  const [asking, setAsking] = useState<{ savable: boolean; resolve: (c: LeaveChoice) => void } | null>(null);

  const register = useCallback((entry: Entry) => {
    entries.current.add(entry);
    return () => {
      entries.current.delete(entry);
    };
  }, []);

  const dirty = useCallback(
    () => Array.from(entries.current).filter((e) => !leaving.current && e.isDirty?.()),
    [],
  );

  // Sequentially, not in parallel: two of these can write the same `show_fees`
  // row set (the charges editor and a step's own save), and a step that opens
  // with an error should not have fired the rest of its writes first.
  const saveAll = useCallback(async () => {
    for (const entry of Array.from(entries.current)) {
      if (entry.flush) await entry.flush();
    }
  }, []);

  const ask = useCallback(
    (savable: boolean) => new Promise<LeaveChoice>((resolve) => setAsking({ savable, resolve })),
    [],
  );

  const markLeaving = useCallback(() => {
    leaving.current = true;
    // A navigation that never happened (a refused route, a cancelled load)
    // must not leave the guard off for good.
    window.setTimeout(() => {
      leaving.current = false;
    }, 4000);
  }, []);

  /** Leave if nothing would be lost, or once somebody has said what to do
   *  about it. Resolves false to stay. */
  const confirmLeave = useCallback(async () => {
    const unsaved = dirty();
    if (unsaved.length === 0) return true;
    const choice = await ask(unsaved.every((e) => e.flush));
    if (choice === 'stay') return false;
    if (choice === 'save') {
      try {
        await saveAll();
      } catch {
        // The step put its own error on screen. Staying is the point.
        return false;
      }
    }
    markLeaving();
    return true;
  }, [ask, dirty, markLeaving, saveAll]);

  const flush = useCallback(async () => {
    const all = Array.from(entries.current);
    await saveAll();
    // What a flush could not save is a form with no flush of its own: ask.
    const unsaved = dirty().filter((e) => !e.flush);
    if (unsaved.length > 0) {
      const choice = await ask(false);
      if (choice === 'stay') throw new StayOnStep();
    }
    markLeaving();
    return all.length > 0;
  }, [ask, dirty, markLeaving, saveAll]);

  // The guard itself: once, on the outermost registry, for every page under it.
  useEffect(() => {
    if (outer) return;

    // Closing the tab, reloading, typing an address, and a Back or Forward
    // that leaves the document: the browser's own prompt is the only one
    // allowed there, and it is shown only when this asks for it.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty().length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };

    // A link off the page, caught before the router sees the click: Next's
    // <Link> navigates in its own handler, and stopping the event here, in
    // capture on the document, is what keeps it from firing.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // a new tab loses nothing
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      // The sidebar's links save the step themselves, through `flush`.
      if (anchor.hasAttribute('data-autosave-link')) return;
      const to = new URL(anchor.href, window.location.href);
      const here = new URL(window.location.href);
      if (to.origin === here.origin && to.pathname === here.pathname && to.search === here.search) return;
      if (dirty().length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmLeave().then((go) => {
        if (go) window.location.assign(to.href);
      });
    };

    // Back and Forward within the app. A client-side navigation never unloads
    // the document, so `beforeunload` cannot see it; the Navigation API can,
    // before the router does, and lets it be cancelled and replayed. Where the
    // browser has no Navigation API, a Back that leaves the document is still
    // caught by the prompt above.
    type NavigateEvent = Event & {
      navigationType: string;
      cancelable: boolean;
      destination: { key: string };
    };
    const nav = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } })
      .navigation;
    const onNavigate = (event: Event) => {
      const e = event as NavigateEvent;
      if (e.navigationType !== 'traverse' || !e.cancelable || dirty().length === 0) return;
      e.preventDefault();
      const key = e.destination.key;
      void confirmLeave().then((go) => {
        if (go) nav?.traverseTo(key);
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    nav?.addEventListener('navigate', onNavigate);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      nav?.removeEventListener('navigate', onNavigate);
    };
  }, [outer, dirty, confirmLeave]);

  const value = useRef<Registry>({ register, flush });
  value.current = { register, flush };

  if (outer) return <>{children}</>;

  return (
    <StepAutosaveContext.Provider value={value.current}>
      {children}
      {asking && (
        <UnsavedChangesDialog
          savable={asking.savable}
          onChoose={(choice) => {
            asking.resolve(choice);
            setAsking(null);
          }}
        />
      )}
    </StepAutosaveContext.Provider>
  );
}

/**
 * Register this component's unsaved work with the step around it.
 *
 * The callbacks are read through refs, so they always see current state — a
 * registration captured on mount would flush the drafts the form opened with.
 * `isDirty` is what lets the guard ask before somebody leaves by a route that
 * does not save (a breadcrumb, the browser's Back); a form without it is saved
 * on the step's own navigation and never asked about.
 */
export function useRegisterStepAutosave(fn: StepFlush, isDirty?: StepDirty): void {
  const ctx = useContext(StepAutosaveContext);
  const latest = useRef(fn);
  latest.current = fn;
  const latestDirty = useRef(isDirty);
  latestDirty.current = isDirty;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register({
      flush: () => latest.current(),
      isDirty: () => latestDirty.current?.() ?? false,
    });
  }, [ctx]);
}

/**
 * Register unsaved work that only its own Save button writes — Step 1's form,
 * the Judges step's half-typed new judge. Leaving with any of it typed asks
 * first, by every route, the step's own Back / Next included.
 */
export function useRegisterUnsavedChanges(isDirty: StepDirty): void {
  const ctx = useContext(StepAutosaveContext);
  const latest = useRef(isDirty);
  latest.current = isDirty;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register({ isDirty: () => latest.current() });
  }, [ctx]);
}

/**
 * What a navigation control calls before it leaves.
 *
 * Returns a no-op outside a step — `WizardStepper` also renders on the setup
 * hub, where there is no form to save and nothing registered. Resolves true
 * when there was a step to save, which is how the sidebar knows whether it
 * needs the full page load below or can navigate in place. Throws — a failed
 * save, or `StayOnStep` — when the control should stay where it is.
 */
export function useStepAutosaveFlush(): () => Promise<boolean> {
  const ctx = useContext(StepAutosaveContext);
  return useCallback(async () => (ctx ? ctx.flush() : false), [ctx]);
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
  title,
  before,
}: {
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  ariaCurrent?: 'step';
  title?: string;
  /** Runs after the step is saved and before leaving it — recording a skip,
   *  say. Throwing stays on the step, like a flush that fails. */
  before?: () => Promise<void>;
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
      title={title}
      onClick={async () => {
        setBusy(true);
        try {
          await flush();
          if (before) await before();
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
