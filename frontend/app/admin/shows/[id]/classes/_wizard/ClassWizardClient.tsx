'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

export type StandardItem = {
  id: string;
  show_type_id?: string | null;
  name: string;
  sort_order: number;
  default_score_type?: string;
};

export type DisciplineItem = {
  id: string;
  name: string;
  sort_order: number | null;
  default_score_type: string;
  class_count?: number;
};

export type DivisionItem = {
  id: string;
  name: string;
  sort_order: number | null;
  class_count?: number;
  discipline_ids: string[];
};

export type ClassItem = {
  id: string;
  show_id: string;
  ring_id: string | null;
  discipline_id: string;
  division_id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  score_type: string;
  entry_fee_cents: number;
  /** Entered by placing first or second in a qualifying class rather than by
   *  signing up (migration 129). Seeded from the class name when the class is
   *  created; the "Must qualify" box on the class list is where a guess gets
   *  corrected. */
  entered_by_qualification: boolean;
  sort_order: number | null;
};

/** The setup step after this one, so Build Classes can end by walking into it. */
export type NextSetupStep = { href: string; label: string };

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  bg: 'var(--surface)',
  highlight: 'var(--warning-bg)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
  done: 'var(--success)',
} as const;

type Step = 1 | 2 | 3;

const STEP_NAMES: Record<Step, string> = {
  1: 'Disciplines',
  2: 'Divisions',
  3: 'Build Classes',
};

/**
 * Mirrors `rules.disciplines.entered_by_qualification` on the backend: the two
 * shapes a class you place into is named on a real schedule. Only a starting
 * guess for the "Must qualify" box on a class somebody is naming — once they
 * tick or untick it themselves, their answer stands.
 */
const QUALIFYING_NAME_RE =
  /\bgrand\s*(?:&|and|\/)\s*reserve\b|\breserve\s*(?:&|and|\/)\s*grand\b|\bgrand\s+champion(?:ship)?\b|\breserve\s+champion(?:ship)?\b/i;

function looksLikeQualifyingClass(name: string): boolean {
  return QUALIFYING_NAME_RE.test(name);
}

/**
 * The Class Builder: disciplines, then divisions, then the classes built from
 * the two.
 *
 * It used to run two ways. Until all three parts had something in them it was a
 * wizard with a small stepper; after that it landed on an overview of three
 * boxes, each opening one part with a "Back to setup overview" link and a Save
 * that returned there. So the same three parts read as a sequence on a new show
 * and as three unrelated sections on a built one, and neither said what came
 * next. Now there is one shape: the progress bar across the top is always there,
 * always says which part you are in and what each holds, and reaches any part
 * whose prerequisites exist in one click; and every part ends in a button that
 * names where it goes.
 */
export default function ClassWizardClient({
  showId,
  showStartDate,
  showEndDate,
  initialDisciplines,
  initialDivisions,
  initialClasses,
  standardDisciplines,
  standardDivisions,
  standardLibraryLabel,
  nextStep = null,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  initialDisciplines: DisciplineItem[];
  initialDivisions: DivisionItem[];
  initialClasses: ClassItem[];
  standardDisciplines: StandardItem[];
  standardDivisions: StandardItem[];
  standardLibraryLabel: string;
  nextStep?: NextSetupStep | null;
}) {
  const router = useRouter();

  // Opens on the first part with nothing in it — and on Build Classes once
  // both building blocks exist, because that is where the work is and the
  // progress bar reaches the other two in one click.
  const initialStep: Step = initialDisciplines.length === 0
    ? 1
    : initialDivisions.length === 0
      ? 2
      : 3;

  const [step, setStep] = useState<Step>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [disciplines, setDisciplines] = useState<DisciplineItem[]>(initialDisciplines);
  const [divisions, setDivisions] = useState<DivisionItem[]>(initialDivisions);
  const [classes, setClasses] = useState<ClassItem[]>(initialClasses);

  const canOpen = (target: Step): boolean =>
    target === 1 ||
    (target === 2 && disciplines.length > 0) ||
    (target === 3 && disciplines.length > 0 && divisions.length > 0);

  function goTo(target: Step) {
    if (!canOpen(target)) return;
    setError(null);
    setStep(target);
  }

  return (
    <div className="space-y-6">
      <ProgressBar
        step={step}
        counts={{ 1: disciplines.length, 2: divisions.length, 3: classes.length }}
        canOpen={canOpen}
        onJump={goTo}
      />

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <DisciplineStep
          showId={showId}
          existing={disciplines}
          standardOptions={standardDisciplines}
          standardLabel={standardLibraryLabel}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onRefreshed={(rows) => setDisciplines(rows)}
          onSaved={(rows) => {
            setDisciplines(rows);
            router.refresh();
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <DivisionStep
          showId={showId}
          disciplines={disciplines}
          existing={divisions}
          standardOptions={standardDivisions}
          standardLabel={standardLibraryLabel}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onBack={() => goTo(1)}
          onRefreshed={(rows) => setDivisions(rows)}
          onSaved={(rows) => {
            setDivisions(rows);
            router.refresh();
            setStep(3);
          }}
        />
      )}
      {step === 3 && (
        <ClassesStep
          showId={showId}
          showStartDate={showStartDate}
          showEndDate={showEndDate}
          disciplines={disciplines}
          divisions={divisions}
          classes={classes}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onChanged={(rows) => setClasses(rows)}
          onBack={() => goTo(2)}
          nextStep={nextStep}
          onDone={() => router.push(nextStep?.href ?? `/admin/shows/${showId}/setup`)}
        />
      )}
    </div>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

/**
 * The three parts, in order, always on screen.
 *
 * Each card says which part it is ("Step 2 of 3"), what it holds, and whether
 * it is where you are; a part that cannot be worked yet is dimmed and its
 * tooltip says what to do first, rather than accepting the click and showing an
 * empty grid.
 */
function ProgressBar({
  step,
  counts,
  canOpen,
  onJump,
}: {
  step: Step;
  counts: Record<Step, number>;
  canOpen: (target: Step) => boolean;
  onJump: (target: Step) => void;
}) {
  const status: Record<Step, string> = {
    1: counts[1] === 0 ? 'None yet' : `${counts[1]} added`,
    2: counts[2] === 0 ? 'None yet' : `${counts[2]} added`,
    3: counts[3] === 0 ? 'No classes yet' : `${counts[3]} class${counts[3] === 1 ? '' : 'es'}`,
  };
  const locked: Record<Step, string> = {
    1: '',
    2: 'Add at least one discipline first',
    3: 'Add at least one discipline and one division first',
  };

  return (
    <nav aria-label="Class Builder progress">
      <ol className="grid grid-cols-3 gap-2">
        {([1, 2, 3] as Step[]).map((key) => {
          const current = key === step;
          const done = counts[key] > 0;
          const open = canOpen(key);
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onJump(key)}
                disabled={!open}
                aria-current={current ? 'step' : undefined}
                title={open ? `Step ${key} of 3: ${STEP_NAMES[key]}` : locked[key]}
                className="w-full h-full text-left rounded-lg px-3 py-2 disabled:cursor-not-allowed"
                style={{
                  border: current
                    ? `2px solid ${COLORS.warn}`
                    : `1px solid ${done ? 'var(--success-border)' : COLORS.border}`,
                  backgroundColor: current
                    ? COLORS.warnSoft
                    : done
                      ? 'var(--success-bg)'
                      : COLORS.bg,
                  opacity: open ? 1 : 0.55,
                }}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0"
                    style={{
                      backgroundColor: done ? COLORS.done : current ? COLORS.warn : COLORS.muted,
                      color: 'var(--surface)',
                    }}
                  >
                    {done ? '✓' : key}
                  </span>
                  <span className="text-xs" style={{ color: COLORS.muted }}>
                    Step {key} of 3
                  </span>
                </span>
                <span className="block text-sm font-semibold mt-1" style={{ color: COLORS.text }}>
                  {STEP_NAMES[key]}
                </span>
                <span className="block text-xs mt-0.5" style={{ color: current ? COLORS.warn : COLORS.muted }}>
                  {status[key]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Step header and footer ─────────────────────────────────────────────────────

function StepHeader({ step, children }: { step: Step; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
        Step {step} of 3: {STEP_NAMES[step]}
      </h2>
      <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
        {children}
      </p>
    </div>
  );
}

/**
 * The bar every part ends with. It sticks to the bottom of the viewport because
 * the standard libraries and the class grid are long enough to push a static
 * footer out of sight — and a button you have to scroll to find reads as a
 * button that doesn't exist. Both buttons name where they go, which is most of
 * what makes the three parts read as a sequence.
 */
function StepFooter({
  onBack,
  backLabel,
  onAction,
  actionLabel,
  disabled,
  disabledTitle,
  hint,
}: {
  onBack?: () => void;
  backLabel?: string;
  onAction: () => void;
  actionLabel: string;
  disabled?: boolean;
  /** Why the action is unavailable, for the disabled button's tooltip. */
  disabledTitle?: string;
  hint?: string;
}) {
  return (
    <div
      // z-40 sits above the class grid's pinned header row and column (z-10 to
      // z-30), which would otherwise paint over this bar as the grid passes
      // under it.
      className="sticky bottom-0 z-40 -mx-4 -mb-4 px-4 py-3 border-t flex items-center justify-between gap-3 flex-wrap"
      style={{
        borderColor: COLORS.border,
        backgroundColor: COLORS.bg,
        // Reads as a bar floating over the content it covers mid-scroll,
        // rather than a row that has cut the grid in half.
        boxShadow: '0 -2px 6px rgba(26, 28, 32, 0.08)',
      }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
        >
          ← {backLabel ?? 'Back'}
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3 flex-wrap justify-end">
        {hint && (
          <span className="text-xs" style={{ color: COLORS.muted }}>
            {hint}
          </span>
        )}
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          className="text-sm rounded px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ── Steps 1 and 2: picking from a library ──────────────────────────────────────

/**
 * Disciplines and divisions are picked the same way — chips already on the
 * show, a standard library to click, and custom names — and differ only in
 * the words and in what a save sends. One component, so the two cannot drift
 * apart in how they behave.
 */
function LibraryPicker({
  noun,
  existing,
  standardOptions,
  standardLabel,
  busy,
  onRemoveExisting,
  checked,
  setChecked,
  customAdds,
  setCustomAdds,
}: {
  noun: 'discipline' | 'division';
  existing: { id: string; name: string; class_count?: number }[];
  standardOptions: StandardItem[];
  standardLabel: string;
  busy: boolean;
  onRemoveExisting: (id: string) => void;
  checked: Set<string>;
  setChecked: (next: Set<string>) => void;
  customAdds: string[];
  setCustomAdds: (next: string[]) => void;
}) {
  const [customDraft, setCustomDraft] = useState('');
  const existingNames = useMemo(
    () => new Set(existing.map((d) => d.name.trim().toLowerCase())),
    [existing],
  );
  const available = useMemo(
    () => standardOptions.filter((o) => !existingNames.has(o.name.trim().toLowerCase())),
    [standardOptions, existingNames],
  );

  function toggle(name: string) {
    const next = new Set(checked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setChecked(next);
  }

  function addCustom() {
    const name = customDraft.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (existingNames.has(lower) || customAdds.some((n) => n.toLowerCase() === lower)) {
      setCustomDraft('');
      return;
    }
    setCustomAdds([...customAdds, name]);
    setCustomDraft('');
  }

  return (
    <>
      {existing.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
            Already added
          </p>
          <div className="flex flex-wrap gap-2">
            {existing.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 text-xs rounded px-2 py-1 border"
                style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: COLORS.done }}
              >
                ✓ {d.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveExisting(d.id)}
                  aria-label={`Remove ${d.name}`}
                  title={
                    d.class_count
                      ? `Cannot remove — ${d.class_count} class${d.class_count === 1 ? '' : 'es'} use this ${noun}`
                      : `Remove ${d.name}`
                  }
                  className="text-xs leading-none disabled:opacity-50"
                  style={{ color: COLORS.muted }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
          Standard library ({standardLabel})
        </p>
        <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
          Click an item to add it to the show; click again to remove it.
        </p>
        {available.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            All standard {noun}s have already been added. Use custom below for
            anything else.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((opt) => {
              const selected = checked.has(opt.name);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.name)}
                  aria-pressed={selected}
                  className="text-sm rounded px-3 py-1.5 border"
                  style={{
                    borderColor: selected ? COLORS.warn : COLORS.border,
                    backgroundColor: selected ? COLORS.highlight : 'var(--surface)',
                    color: selected ? COLORS.warn : COLORS.text,
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {selected ? '✓ ' : '+ '}
                  {opt.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
          Custom {noun}s
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {customAdds.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 border border-dashed"
              style={{ borderColor: 'var(--warning-border)', backgroundColor: COLORS.highlight, color: COLORS.warn }}
            >
              {n}
              <button
                type="button"
                onClick={() => setCustomAdds(customAdds.filter((x) => x !== n))}
                aria-label={`Remove ${n}`}
                className="text-xs leading-none"
                style={{ color: COLORS.muted }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder={`Add custom ${noun}…`}
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            className="text-sm border rounded px-2 py-1"
            style={{ borderColor: COLORS.border, minWidth: '14rem' }}
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!customDraft.trim()}
            className="text-sm rounded px-3 py-1 border disabled:opacity-50"
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
          >
            Add
          </button>
        </div>
      </div>
    </>
  );
}

function continueLabel(busy: boolean, toAdd: number, destination: string): string {
  if (busy) return 'Saving…';
  return toAdd > 0
    ? `Save ${toAdd} & continue to ${destination} →`
    : `Continue to ${destination} →`;
}

// ── Step 1: Disciplines ────────────────────────────────────────────────────────

function DisciplineStep({
  showId,
  existing,
  standardOptions,
  standardLabel,
  busy,
  setBusy,
  setError,
  onRefreshed,
  onSaved,
}: {
  showId: string;
  existing: DisciplineItem[];
  standardOptions: StandardItem[];
  standardLabel: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onRefreshed: (rows: DisciplineItem[]) => void;
  onSaved: (rows: DisciplineItem[]) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [customAdds, setCustomAdds] = useState<string[]>([]);
  const newNames = [...Array.from(checked), ...customAdds];

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/disciplines/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to remove discipline.');
        return;
      }
      const listRes = await fetch(`/api/shows/${showId}/disciplines`, { cache: 'no-store' });
      onRefreshed(await listRes.json());
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (newNames.length > 0) {
        const res = await fetch(`/api/shows/${showId}/disciplines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: newNames }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(json?.detail || 'Failed to save disciplines.');
          return;
        }
      }
      // Re-fetch the full list so we have IDs from any newly created rows.
      const listRes = await fetch(`/api/shows/${showId}/disciplines`, { cache: 'no-store' });
      const listJson = (await listRes.json()) as DisciplineItem[];
      onSaved(listJson);
    } finally {
      setBusy(false);
    }
  }

  const nothingYet = newNames.length === 0 && existing.length === 0;

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <StepHeader step={1}>
        The riding styles this show offers — Halter, Western Pleasure, Trail. Pick
        from the standard list, add your own, or both. Next you pick the divisions,
        then combine the two into classes.
      </StepHeader>

      <LibraryPicker
        noun="discipline"
        existing={existing}
        standardOptions={standardOptions}
        standardLabel={standardLabel}
        busy={busy}
        onRemoveExisting={remove}
        checked={checked}
        setChecked={setChecked}
        customAdds={customAdds}
        setCustomAdds={setCustomAdds}
      />

      <StepFooter
        onAction={save}
        disabled={busy || nothingYet}
        disabledTitle={nothingYet ? 'Pick at least one discipline, or add a custom one' : undefined}
        actionLabel={continueLabel(busy, newNames.length, 'Divisions')}
        hint={`${existing.length} on this show`}
      />
    </section>
  );
}

// ── Step 2: Divisions ──────────────────────────────────────────────────────────

function DivisionStep({
  showId,
  disciplines,
  existing,
  standardOptions,
  standardLabel,
  busy,
  setBusy,
  setError,
  onBack,
  onRefreshed,
  onSaved,
}: {
  showId: string;
  disciplines: DisciplineItem[];
  existing: DivisionItem[];
  standardOptions: StandardItem[];
  standardLabel: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onBack: () => void;
  onRefreshed: (rows: DivisionItem[]) => void;
  onSaved: (rows: DivisionItem[]) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [customAdds, setCustomAdds] = useState<string[]>([]);
  const newNames = [...Array.from(checked), ...customAdds];

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/divisions/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to remove division.');
        return;
      }
      const listRes = await fetch(`/api/shows/${showId}/divisions`, { cache: 'no-store' });
      onRefreshed(await listRes.json());
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (newNames.length > 0) {
        // Wire new divisions to every existing discipline so the (Discipline,
        // Division) pair is registered for any class built in step 3.
        const res = await fetch(`/api/shows/${showId}/divisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            names: newNames,
            discipline_ids: disciplines.map((d) => d.id),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(json?.detail || 'Failed to save divisions.');
          return;
        }
      }
      const listRes = await fetch(`/api/shows/${showId}/divisions`, { cache: 'no-store' });
      const listJson = (await listRes.json()) as DivisionItem[];
      onSaved(listJson);
    } finally {
      setBusy(false);
    }
  }

  const nothingYet = newNames.length === 0 && existing.length === 0;

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <StepHeader step={2}>
        The age, skill, or horse-age brackets — Amateur, Youth 14-18, Two-Year-Olds.
        Every division is offered under each discipline from step 1. Next you build
        the classes by pairing the two up.
      </StepHeader>

      <LibraryPicker
        noun="division"
        existing={existing}
        standardOptions={standardOptions}
        standardLabel={standardLabel}
        busy={busy}
        onRemoveExisting={remove}
        checked={checked}
        setChecked={setChecked}
        customAdds={customAdds}
        setCustomAdds={setCustomAdds}
      />

      <StepFooter
        onBack={onBack}
        backLabel="Back to Disciplines"
        onAction={save}
        disabled={busy || nothingYet}
        disabledTitle={nothingYet ? 'Pick at least one division, or add a custom one' : undefined}
        actionLabel={continueLabel(busy, newNames.length, 'Build Classes')}
        hint={`${existing.length} on this show`}
      />
    </section>
  );
}

// ── Step 3: Build Classes ──────────────────────────────────────────────────────

function cellKey(disciplineId: string, divisionId: string): string {
  return `${disciplineId}::${divisionId}`;
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Orders a class list the way the backend numbers it: by day, then position. */
function scheduleOrder(rows: ClassItem[]): ClassItem[] {
  return [...rows].sort(
    (a, b) =>
      a.class_date.localeCompare(b.class_date) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
}

/**
 * A scroll box with a second horizontal scrollbar along its top edge.
 *
 * The class grid is as wide as the show has disciplines, and a show with
 * twenty-two of them is several screens across. The box's own scrollbar runs
 * along its bottom edge, below the fold on any grid worth scrolling, so the one
 * on top mirrors it and the two are kept in step both ways.
 *
 * The box also scrolls vertically inside itself, capped at most of the
 * viewport, rather than growing with the page. That is what lets the header row
 * stick: `position: sticky` pins to the nearest scrolling ancestor, and a box
 * that scrolls sideways already is one — so the discipline names can only stay
 * in view while the divisions scroll past if that same box scrolls them.
 */
function DualScrollBox({ children, maxHeight }: { children: React.ReactNode; maxHeight: string }) {
  const topRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const top = topRef.current;
    const box = boxRef.current;
    if (!top || !box) return;

    const measure = () => {
      setScrollWidth(box.scrollWidth);
      setOverflowing(box.scrollWidth > box.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);

    // Each side writes only when the other has actually moved. Setting the
    // same scrollLeft fires no scroll event, so the pair settles rather than
    // bouncing off each other.
    const fromBox = () => {
      if (Math.abs(top.scrollLeft - box.scrollLeft) > 1) top.scrollLeft = box.scrollLeft;
    };
    const fromTop = () => {
      if (Math.abs(box.scrollLeft - top.scrollLeft) > 1) box.scrollLeft = top.scrollLeft;
    };
    box.addEventListener('scroll', fromBox, { passive: true });
    top.addEventListener('scroll', fromTop, { passive: true });
    return () => {
      observer.disconnect();
      box.removeEventListener('scroll', fromBox);
      top.removeEventListener('scroll', fromTop);
    };
  }, []);

  return (
    <div>
      <div
        ref={topRef}
        hidden={!overflowing}
        aria-hidden="true"
        className="overflow-x-auto overflow-y-hidden mb-1"
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div ref={boxRef} className="overflow-auto" style={{ maxHeight }}>
        {children}
      </div>
    </div>
  );
}

function ClassesStep({
  showId,
  showStartDate,
  showEndDate,
  disciplines,
  divisions,
  classes,
  busy,
  setBusy,
  setError,
  onChanged,
  onBack,
  nextStep,
  onDone,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  disciplines: DisciplineItem[];
  divisions: DivisionItem[];
  classes: ClassItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onChanged: (rows: ClassItem[]) => void;
  onBack: () => void;
  nextStep: NextSetupStep | null;
  onDone: () => void;
}) {
  const [classDate, setClassDate] = useState(showStartDate);
  // The schedule can run to hundreds of rows; it lives below the picker and
  // stays folded so the grid — the thing being worked in — owns the screen.
  const [listOpen, setListOpen] = useState(false);
  // Date-qualified cell keys (`${classDate}::${disciplineId}::${divisionId}`)
  // for picks that have been clicked but whose create hasn't reconciled into
  // `classes` yet — drives the in-flight "…" marker on the grid.
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
  const [savingOrder, setSavingOrder] = useState(false);
  // Classes whose "Must qualify" box is mid-save. Per row rather than the
  // step-wide `busy`, so ticking one box does not freeze every other control.
  const [pendingQualify, setPendingQualify] = useState<Set<string>>(new Set());
  // Opening the by-name form with the Grand & Reserve shortcut bumps this, so
  // the form can prefill itself without the step reaching into its state.
  const [namedClassPreset, setNamedClassPreset] = useState<{ kind: 'blank' | 'grand'; nonce: number } | null>(null);

  // Serialize class creates: clicking "+" enqueues a job and a single drainer
  // POSTs them one at a time, so the backend's per-create renumber can't race
  // with itself when the secretary clicks several cells quickly.
  const queueRef = useRef<{ disciplineId: string; divisionId: string; classDate: string }[]>([]);
  const processingRef = useRef(false);

  const dates = useMemo(() => enumerateDates(showStartDate, showEndDate), [showStartDate, showEndDate]);

  const disciplineById = useMemo(
    () => new Map(disciplines.map((d) => [d.id, d])),
    [disciplines],
  );
  const divisionById = useMemo(
    () => new Map(divisions.map((d) => [d.id, d])),
    [divisions],
  );

  // Existing-class (discipline, division) pairs scoped to the selected date.
  // Cells in that set are disabled in the grid so the secretary can't queue a
  // duplicate for that day. A class entered by qualifying does not count: a
  // Grand & Reserve class filed under Halter × Amateur is a call-back from the
  // ordinary Amateur Halter class, not that class, and adding one must not
  // make the grid claim the other already exists.
  const takenForDate = useMemo(
    () =>
      new Set(
        classes
          .filter((c) => c.class_date === classDate && !c.entered_by_qualification)
          .map((c) => cellKey(c.discipline_id, c.division_id)),
      ),
    [classes, classDate],
  );

  // For the existing-classes display, group by date so a multi-day show
  // doesn't blob into one undifferentiated list.
  const classesByDate = useMemo(() => {
    const byDate = new Map<string, ClassItem[]>();
    for (const c of classes) {
      const arr = byDate.get(c.class_date) ?? [];
      arr.push(c);
      byDate.set(c.class_date, arr);
    }
    for (const arr of byDate.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [classes]);

  async function refreshClasses(): Promise<ClassItem[] | null> {
    const res = await fetch(`/api/shows/${showId}/classes`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as ClassItem[];
    onChanged(json);
    return json;
  }

  /** Saves a whole-show running order and renumbers to match. Numbers run
   *  1..N across the whole show, ordered by date then position, so any move
   *  persists the full ordered id list. */
  async function saveOrder(ordered: ClassItem[]) {
    // Optimistically renumber to match the new global position so the list
    // doesn't flash stale numbers while the save is in flight.
    const renumbered = ordered.map((c, i) => ({
      ...c,
      sort_order: i + 1,
      class_number: String(i + 1),
    }));
    onChanged(renumbered);

    setSavingOrder(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: renumbered.map((c) => c.id) }),
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to save the new order.');
        await refreshClasses();
      }
    } finally {
      setSavingOrder(false);
    }
  }

  // Drag-and-drop reorder, scoped to a single day.
  async function handleDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    // Days are independent Droppables — ignore cross-day drops.
    if (destination.droppableId !== source.droppableId) return;
    if (destination.index === source.index) return;

    const date = source.droppableId;
    const reordered: ClassItem[] = [];
    for (const [d, dayClasses] of classesByDate) {
      if (d === date) {
        const arr = [...dayClasses];
        const [moved] = arr.splice(source.index, 1);
        arr.splice(destination.index, 0, moved);
        reordered.push(...arr);
      } else {
        reordered.push(...dayClasses);
      }
    }
    setError(null);
    await saveOrder(reordered);
  }

  // Clicking a "+" cell adds that class immediately — no separate confirm step.
  function addCell(disciplineId: string, divisionId: string) {
    const k = cellKey(disciplineId, divisionId);
    const dk = `${classDate}::${k}`;
    if (takenForDate.has(k) || queuedKeys.has(dk)) return;
    setQueuedKeys((prev) => new Set(prev).add(dk));
    queueRef.current.push({ disciplineId, divisionId, classDate });
    void drainQueue();
  }

  async function drainQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    setError(null);
    const processed: string[] = [];
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift()!;
        const dk = `${job.classDate}::${cellKey(job.disciplineId, job.divisionId)}`;
        const disc = disciplineById.get(job.disciplineId);
        const div = divisionById.get(job.divisionId);
        if (!disc || !div) {
          processed.push(dk);
          continue;
        }
        const className = `${div.name} ${disc.name}`;
        try {
          const res = await fetch(`/api/shows/${showId}/classes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              discipline_id: job.disciplineId,
              division_id: job.divisionId,
              class_name: className,
              class_date: job.classDate,
              status: 'OPEN',
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            setError(j?.detail || `Failed to create "${className}".`);
          }
        } catch {
          setError(`Failed to create "${className}".`);
        } finally {
          processed.push(dk);
        }
      }
    } finally {
      processingRef.current = false;
      await refreshClasses();
      // Drop only the markers this drainer handled. Successful cells are now
      // "taken" via `classes`; failed cells fall back to "+" so they retry.
      // A concurrent drainer keeps its own in-flight markers untouched.
      setQueuedKeys((prev) => {
        const next = new Set(prev);
        for (const dk of processed) next.delete(dk);
        return next;
      });
    }
  }

  /**
   * Tick or untick "Must qualify" on one class.
   *
   * Seeded from the class name when the class is created — "Grand & Reserve
   * Amateur Stallions" is not a class anybody signs up for — but a name is a
   * guess and this is where it gets corrected in either direction. A show that
   * has run a class called "Reserve Champion Trail" as an ordinary open class
   * for twenty years unticks it here and it stays unticked.
   *
   * The consequence is one-sided: ticked, the class disappears from the
   * exhibitor's class picker and `POST /shows/{id}/register` refuses it. The
   * desk keeps entering it, because the office is standing there when the judge
   * calls the horses back. Unticked is simply open entry.
   *
   * Saved optimistically, because a box that waits on a round trip before it
   * shows its own tick reads as a box that did not take the click.
   */
  async function toggleQualification(cls: ClassItem) {
    const next = !cls.entered_by_qualification;
    setError(null);
    setPendingQualify((prev) => new Set(prev).add(cls.id));
    onChanged(classes.map((c) => (c.id === cls.id ? { ...c, entered_by_qualification: next } : c)));
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${cls.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entered_by_qualification: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || `Could not update "${cls.class_name}".`);
        await refreshClasses();
      }
    } catch {
      setError(`Could not update "${cls.class_name}".`);
      await refreshClasses();
    } finally {
      setPendingQualify((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(cls.id);
        return nextSet;
      });
    }
  }

  async function removeClass(classId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/${classId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Failed to delete class.');
        return;
      }
      await refreshClasses();
    } finally {
      setBusy(false);
    }
  }

  const noBuildingBlocks = disciplines.length === 0 || divisions.length === 0;
  const adding = queuedKeys.size > 0;

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <StepHeader step={3}>
        Every class is a division in a discipline. Pick the show day, then click a
        square in the grid to add that class — it saves straight away and is
        numbered in running order. For a class with a name of its own, such as a
        Grand &amp; Reserve champion class, use <em>Add a class by name</em> under
        the grid.
      </StepHeader>

      {/* ── The grid ──────────────────────────────────────────────────── */}
      <div
        className="rounded border p-3 space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
      >
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Show day
            </span>
            <select
              value={classDate}
              onChange={(e) => setClassDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
            >
              {dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            <span style={{ fontWeight: 600 }}>+</span> adds the class ·{' '}
            <span style={{ fontWeight: 600 }}>✓</span> is already a class on this day
          </p>
        </div>

        {noBuildingBlocks ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            Add at least one discipline and one division in steps 1 and 2 to build
            classes here.
          </p>
        ) : (
          <DualScrollBox maxHeight="70vh">
            {/* Separate borders rather than collapsed: a collapsed border belongs
                to the table, not the cell, so it would scroll away from a
                sticky header and leave the names floating over the grid. */}
            <table className="text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-30 text-left font-semibold pr-3 py-2 border-b align-bottom"
                    style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.text }}
                    scope="col"
                  >
                    Division ╲ Discipline
                  </th>
                  {disciplines.map((disc) => (
                    <th
                      key={disc.id}
                      className="sticky top-0 z-20 font-medium text-xs px-2 py-2 border-b text-center align-bottom"
                      style={{
                        borderColor: COLORS.border,
                        backgroundColor: COLORS.warnSoft,
                        color: COLORS.warn,
                        minWidth: '5rem',
                      }}
                      title={disc.name}
                      scope="col"
                    >
                      {disc.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {divisions.map((div) => (
                  <tr key={div.id}>
                    <th
                      className="sticky left-0 z-10 text-left font-normal pr-3 py-1.5 border-b"
                      style={{
                        borderColor: COLORS.borderSoft,
                        backgroundColor: COLORS.warnSoft,
                        color: COLORS.text,
                      }}
                      scope="row"
                    >
                      {div.name}
                    </th>
                    {disciplines.map((disc) => {
                      const k = cellKey(disc.id, div.id);
                      const taken = takenForDate.has(k);
                      const queued = queuedKeys.has(`${classDate}::${k}`);
                      const disabled = taken || queued;
                      const title = taken
                        ? `${div.name} ${disc.name} is already on the schedule for ${classDate}`
                        : queued
                          ? `Adding ${div.name} ${disc.name}…`
                          : `Add ${div.name} ${disc.name}`;
                      return (
                        <td
                          key={disc.id}
                          className="text-center border-b p-0.5"
                          style={{ borderColor: COLORS.borderSoft }}
                        >
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => addCell(disc.id, div.id)}
                            title={title}
                            aria-label={title}
                            className="w-full text-xs font-medium rounded px-2 py-1"
                            style={{
                              backgroundColor: taken
                                ? 'var(--border-subtle)'
                                : queued
                                  ? COLORS.highlight
                                  : 'var(--surface)',
                              color: taken
                                ? COLORS.muted
                                : queued
                                  ? COLORS.warn
                                  : COLORS.text,
                              border: queued
                                ? `1px solid ${COLORS.warn}`
                                : `1px solid ${COLORS.border}`,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              minWidth: '3.5rem',
                            }}
                          >
                            {taken ? '✓' : queued ? '…' : '+'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </DualScrollBox>
        )}

        {adding && (
          <p className="text-xs font-medium pt-1" style={{ color: COLORS.warn }}>
            Adding {queuedKeys.size} class{queuedKeys.size === 1 ? '' : 'es'}…
          </p>
        )}
      </div>

      {/* ── A class the grid cannot name ──────────────────────────────── */}
      {!noBuildingBlocks && (
        namedClassPreset ? (
          <AddNamedClass
            key={namedClassPreset.nonce}
            preset={namedClassPreset.kind}
            showId={showId}
            dates={dates}
            defaultDate={classDate}
            disciplines={disciplines}
            divisions={divisions}
            classes={classes}
            setError={setError}
            refreshClasses={refreshClasses}
            saveOrder={saveOrder}
            onClose={() => setNamedClassPreset(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setNamedClassPreset({ kind: 'blank', nonce: Date.now() })}
              className="text-sm rounded px-3 py-1.5 border"
              style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
            >
              + Add a class by name
            </button>
            <button
              type="button"
              onClick={() => setNamedClassPreset({ kind: 'grand', nonce: Date.now() })}
              className="text-sm rounded px-3 py-1.5 border"
              style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
              title="A championship class the top placings are called back to — entry is by qualifying"
            >
              + Add a Grand &amp; Reserve class
            </button>
          </div>
        )
      )}

      {/* ── The schedule so far ───────────────────────────────────────────
          Below the grid and folded by default: a built-out show runs to
          hundreds of classes, and the grid is what the secretary is working
          in. The count in the header is the live feedback that a click
          landed; the ✓ on the grid cell is the other half. */}
      {classes.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No classes yet.
        </p>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            className="w-full flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)', color: COLORS.text }}
          >
            <span className="font-medium">
              <span aria-hidden>{listOpen ? '▾' : '▸'}</span> Classes added ({classes.length})
            </span>
            <span className="text-xs" style={{ color: COLORS.muted }}>
              {listOpen ? 'Hide' : 'Reorder, mark Must qualify, or delete'}
            </span>
          </button>

          {listOpen && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <p className="text-xs mt-3" style={{ color: COLORS.muted }}>
                Tick <strong>Must qualify</strong> on a class that is entered by
                qualifying, such as a Grand &amp; Reserve champion class — exhibitors
                can&rsquo;t enter it themselves, and the desk enters the horses called
                back. Every unticked class is open entry.
              </p>
              <div className="space-y-3 mt-3">
                {classesByDate.map(([date, dayClasses]) => (
                  <div key={date}>
                    <p
                      className="text-xs font-medium mb-1 flex items-center gap-2"
                      style={{ color: COLORS.muted }}
                    >
                      {date} — {dayClasses.length} class
                      {dayClasses.length === 1 ? '' : 'es'}
                      {dayClasses.length > 1 && (
                        <span style={{ color: COLORS.border }}>· drag to reorder</span>
                      )}
                      {savingOrder && (
                        <span style={{ color: COLORS.done }}>· saving…</span>
                      )}
                    </p>
                    <Droppable droppableId={date}>
                      {(dropProvided) => (
                        <ul
                          ref={dropProvided.innerRef}
                          {...dropProvided.droppableProps}
                          className="space-y-1"
                        >
                          {dayClasses.map((c, index) => (
                            <Draggable key={c.id} draggableId={c.id} index={index}>
                              {(dragProvided, snapshot) => (
                                <li
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  className="flex items-center justify-between gap-2 text-sm border-b py-1"
                                  style={{
                                    borderColor: COLORS.borderSoft,
                                    backgroundColor: snapshot.isDragging
                                      ? COLORS.highlight
                                      : 'transparent',
                                    ...dragProvided.draggableProps.style,
                                  }}
                                >
                                  <span className="flex items-center gap-2 min-w-0" style={{ color: COLORS.text }}>
                                    <span
                                      {...dragProvided.dragHandleProps}
                                      className="cursor-grab active:cursor-grabbing select-none shrink-0"
                                      title="Drag to reorder"
                                      aria-label="Drag to reorder"
                                      style={{ color: COLORS.border }}
                                    >
                                      ⠿
                                    </span>
                                    <span className="font-mono shrink-0" style={{ color: 'var(--accent)' }}>
                                      #{c.class_number}
                                    </span>
                                    <span className="truncate">{c.class_name}</span>
                                  </span>
                                  <span className="flex items-center gap-4 shrink-0">
                                    <label
                                      className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                                      style={{ color: COLORS.text }}
                                      title="Ticked: entry is by qualifying — the top placings from the qualifying classes are called back, so exhibitors can't enter it themselves (the desk still can). Unticked: open entry."
                                    >
                                      <input
                                        type="checkbox"
                                        checked={c.entered_by_qualification}
                                        disabled={pendingQualify.has(c.id)}
                                        onChange={() => toggleQualification(c)}
                                      />
                                      Must qualify
                                    </label>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => removeClass(c.id)}
                                      className="text-xs hover:underline disabled:opacity-50"
                                      style={{ color: 'var(--error-strong)' }}
                                    >
                                      Delete
                                    </button>
                                  </span>
                                </li>
                              )}
                            </Draggable>
                          ))}
                          {dropProvided.placeholder}
                        </ul>
                      )}
                    </Droppable>
                  </div>
                ))}
              </div>
            </DragDropContext>
          )}
        </div>
      )}

      {/* Classes save as they are added, so this finishes the part rather than
          saving it — and carries on into the next setup step, which is where a
          secretary who has just built a schedule is going. */}
      <StepFooter
        onBack={onBack}
        backLabel="Back to Divisions"
        onAction={onDone}
        disabled={busy || adding}
        disabledTitle={adding ? 'Wait for the classes being added to save' : undefined}
        actionLabel={
          adding
            ? 'Adding…'
            : nextStep
              ? `Done — continue to ${nextStep.label} →`
              : 'Done — back to setup →'
        }
        hint={`${classes.length} class${classes.length === 1 ? '' : 'es'} saved`}
      />
    </section>
  );
}

// ── Add a class by name ────────────────────────────────────────────────────────

/**
 * A class the grid cannot name.
 *
 * The grid names every class "{Division} {Discipline}", which is right for an
 * ordinary class and wrong for the ones a show bill names for themselves — a
 * Grand & Reserve champion class above all, which is not a division crossed
 * with a discipline but a call-back from the classes before it. There was no
 * way to add one here at all. So this takes the name as typed, the day, where
 * in that day it runs, and whether entry is by qualifying.
 *
 * Placement is part of the form rather than left to dragging afterwards,
 * because a Grand & Reserve class belongs straight after the classes it calls
 * back from, and dragging it there down a list of a hundred rows is the job
 * nobody finishes. The `grand` preset opens with Halter picked, the name
 * started, "Must qualify" ticked, and the class placed after the last class on
 * that day in the same discipline and division.
 */
function AddNamedClass({
  preset,
  showId,
  dates,
  defaultDate,
  disciplines,
  divisions,
  classes,
  setError,
  refreshClasses,
  saveOrder,
  onClose,
}: {
  preset: 'blank' | 'grand';
  showId: string;
  dates: string[];
  defaultDate: string;
  disciplines: DisciplineItem[];
  divisions: DivisionItem[];
  classes: ClassItem[];
  setError: (msg: string | null) => void;
  refreshClasses: () => Promise<ClassItem[] | null>;
  saveOrder: (ordered: ClassItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const halter = disciplines.find((d) => /halter/i.test(d.name) && !/performance/i.test(d.name));
  const startDiscipline = (preset === 'grand' && halter ? halter : disciplines[0])?.id ?? '';
  const startDivision = divisions[0]?.id ?? '';

  const [disciplineId, setDisciplineId] = useState(startDiscipline);
  const [divisionId, setDivisionId] = useState(startDivision);
  const [date, setDate] = useState(defaultDate);
  // Untouched, the name follows the pickers; once somebody types, it is theirs.
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [mustQualify, setMustQualify] = useState(preset === 'grand');
  const [qualifyTouched, setQualifyTouched] = useState(preset === 'grand');
  const [placeAfter, setPlaceAfter] = useState<string>('auto');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const disc = disciplines.find((d) => d.id === disciplineId);
  const div = divisions.find((d) => d.id === divisionId);
  const suggestedName = disc && div
    ? `${preset === 'grand' ? 'Grand & Reserve ' : ''}${div.name} ${disc.name}`
    : '';
  const effectiveName = nameTouched ? name : suggestedName;
  const effectiveQualify = qualifyTouched ? mustQualify : looksLikeQualifyingClass(effectiveName);

  const dayClasses = useMemo(
    () => scheduleOrder(classes).filter((c) => c.class_date === date),
    [classes, date],
  );
  // "auto" is the default for the Grand & Reserve preset: straight after the
  // last class that day in the same cell, which is where the classes it calls
  // back from run. Otherwise, and when there is no such class, the end of the day.
  const autoAfter = useMemo(() => {
    if (preset !== 'grand') return null;
    const sameCell = dayClasses.filter(
      (c) => c.discipline_id === disciplineId && c.division_id === divisionId,
    );
    return sameCell.length > 0 ? sameCell[sameCell.length - 1] : null;
  }, [preset, dayClasses, disciplineId, divisionId]);
  const afterId = placeAfter === 'auto' ? autoAfter?.id ?? 'end' : placeAfter;

  async function submit() {
    const className = effectiveName.trim();
    if (!className || !disciplineId || !divisionId) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discipline_id: disciplineId,
          division_id: divisionId,
          class_name: className,
          class_date: date,
          status: 'OPEN',
          entered_by_qualification: effectiveQualify,
        }),
      });
      const created = await res.json().catch(() => null);
      if (!res.ok || !created?.id) {
        setError(created?.detail || `Failed to create "${className}".`);
        return;
      }

      const rows = await refreshClasses();
      let where = 'at the end of the day';
      if (rows && afterId !== 'end') {
        const ordered = scheduleOrder(rows);
        const mine = ordered.find((c) => c.id === created.id);
        const rest = ordered.filter((c) => c.id !== created.id);
        const at = rest.findIndex((c) => c.id === afterId);
        if (mine && at >= 0 && rest[at].class_date === date) {
          rest.splice(at + 1, 0, mine);
          await saveOrder(rest);
          where = `after #${rest[at].class_number}`;
        }
      }

      setNotice(`Added "${className}" on ${date}, ${where}.`);
      setName('');
      setNameTouched(false);
      setQualifyTouched(preset === 'grand');
      setMustQualify(preset === 'grand');
      setPlaceAfter('auto');
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = { borderColor: COLORS.border, backgroundColor: 'var(--surface)', color: COLORS.text };

  return (
    <div
      className="rounded border p-3 space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            {preset === 'grand' ? 'Add a Grand & Reserve class' : 'Add a class by name'}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            {preset === 'grand'
              ? 'The top placings from the classes before it are called back, so entry is by qualifying. Name it the way your show bill does — "Grand & Reserve Amateur Mares".'
              : 'For a class the grid cannot name. It is filed under the discipline and division you pick.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs hover:underline shrink-0"
          style={{ color: COLORS.muted }}
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs" style={{ color: COLORS.muted }}>
          Discipline
          <select
            value={disciplineId}
            onChange={(e) => setDisciplineId(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            style={fieldStyle}
          >
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs" style={{ color: COLORS.muted }}>
          Division
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            style={fieldStyle}
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs" style={{ color: COLORS.muted }}>
          Show day
          <select
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPlaceAfter('auto');
            }}
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            style={fieldStyle}
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs" style={{ color: COLORS.muted }}>
        Class name
        <input
          type="text"
          value={effectiveName}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          maxLength={200}
          className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
          style={fieldStyle}
        />
      </label>

      <label className="block text-xs" style={{ color: COLORS.muted }}>
        Runs
        <select
          value={placeAfter === 'auto' ? afterId : placeAfter}
          onChange={(e) => setPlaceAfter(e.target.value)}
          className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
          style={fieldStyle}
        >
          <option value="end">At the end of {date}</option>
          {dayClasses.map((c) => (
            <option key={c.id} value={c.id}>
              After #{c.class_number} {c.class_name}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex items-start gap-2 text-sm cursor-pointer"
        style={{ color: COLORS.text }}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={effectiveQualify}
          onChange={(e) => {
            setMustQualify(e.target.checked);
            setQualifyTouched(true);
          }}
        />
        <span>
          Must qualify
          <span className="block text-xs" style={{ color: COLORS.muted }}>
            Exhibitors can&rsquo;t enter it themselves; the desk enters the horses
            called back. Leave it unticked for open entry.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !effectiveName.trim()}
          title={!effectiveName.trim() ? 'Give the class a name' : undefined}
          className="text-sm rounded px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
        >
          {saving ? 'Adding…' : 'Add class'}
        </button>
        {notice && (
          <span className="text-xs" role="status" style={{ color: COLORS.done }}>
            ✓ {notice}
          </span>
        )}
      </div>
    </div>
  );
}
