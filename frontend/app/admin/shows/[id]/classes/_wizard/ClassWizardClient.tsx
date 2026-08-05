'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

export type StandardItem = {
  id: string;
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
  sort_order: number | null;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  highlight: '#fef3c7',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
  done: '#2f6b3f',
} as const;

type Step = 1 | 2 | 3;
type Mode = 'wizard' | 'hub';

export default function ClassWizardClient({
  showId,
  showStartDate,
  showEndDate,
  initialDisciplines,
  initialDivisions,
  initialClasses,
  standardDisciplines,
  standardDivisions,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  initialDisciplines: DisciplineItem[];
  initialDivisions: DivisionItem[];
  initialClasses: ClassItem[];
  standardDisciplines: StandardItem[];
  standardDivisions: StandardItem[];
}) {
  const router = useRouter();

  const initialStep: Step = initialDisciplines.length === 0
    ? 1
    : initialDivisions.length === 0
      ? 2
      : 3;
  // Once every section already has data, skip the linear step-through and
  // land on the overview so editing a single section doesn't mean walking
  // back through steps that are already configured.
  const allConfigured =
    initialDisciplines.length > 0 && initialDivisions.length > 0 && initialClasses.length > 0;

  const [mode, setMode] = useState<Mode>(allConfigured ? 'hub' : 'wizard');
  const [step, setStep] = useState<Step>(initialStep);
  const [hubSection, setHubSection] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [disciplines, setDisciplines] = useState<DisciplineItem[]>(initialDisciplines);
  const [divisions, setDivisions] = useState<DivisionItem[]>(initialDivisions);
  const [classes, setClasses] = useState<ClassItem[]>(initialClasses);

  if (mode === 'hub' && hubSection === null) {
    return (
      <HubOverview
        disciplines={disciplines}
        divisions={divisions}
        classes={classes}
        onEdit={(section) => setHubSection(section)}
      />
    );
  }

  const editing = mode === 'hub';
  const activeStep = editing ? hubSection! : step;
  const backToOverview = () => setHubSection(null);

  return (
    <div className="space-y-6">
      {editing ? (
        <button
          type="button"
          onClick={backToOverview}
          className="text-sm hover:underline"
          style={{ color: '#8b4513' }}
        >
          ← Back to setup overview
        </button>
      ) : (
        <Stepper
          step={step}
          steps={[
            { key: 1, label: '1. Disciplines', done: disciplines.length > 0 },
            { key: 2, label: '2. Divisions', done: divisions.length > 0 },
            { key: 3, label: '3. Classes', done: classes.length > 0 },
          ]}
          onJump={(target) => {
            if (target === 2 && disciplines.length === 0) return;
            if (target === 3 && (disciplines.length === 0 || divisions.length === 0)) return;
            setStep(target);
          }}
        />
      )}

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {activeStep === 1 && (
        <DisciplineStep
          mode={editing ? 'hub' : 'wizard'}
          showId={showId}
          existing={disciplines}
          standardOptions={standardDisciplines}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onRefreshed={(rows) => setDisciplines(rows)}
          onSaved={(rows) => {
            setDisciplines(rows);
            router.refresh();
            if (editing) backToOverview();
            else setStep(2);
          }}
        />
      )}
      {activeStep === 2 && (
        <DivisionStep
          mode={editing ? 'hub' : 'wizard'}
          showId={showId}
          disciplines={disciplines}
          existing={divisions}
          standardOptions={standardDivisions}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onBack={editing ? undefined : () => setStep(1)}
          onRefreshed={(rows) => setDivisions(rows)}
          onSaved={(rows) => {
            setDivisions(rows);
            router.refresh();
            if (editing) backToOverview();
            else setStep(3);
          }}
        />
      )}
      {activeStep === 3 && (
        <ClassesStep
          mode={editing ? 'hub' : 'wizard'}
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
          onBack={editing ? undefined : () => setStep(2)}
          onDone={
            editing
              ? backToOverview
              : () => {
                  if (disciplines.length > 0 && divisions.length > 0 && classes.length > 0) {
                    setMode('hub');
                  } else {
                    router.push(`/admin/shows/${showId}`);
                  }
                }
          }
        />
      )}
    </div>
  );
}

// ── Setup overview (post-configuration edit hub) ────────────────────────────────

function HubOverview({
  disciplines,
  divisions,
  classes,
  onEdit,
}: {
  disciplines: DisciplineItem[];
  divisions: DivisionItem[];
  classes: ClassItem[];
  onEdit: (section: Step) => void;
}) {
  const items: { key: Step; label: string; hint: string; done: boolean }[] = [
    {
      key: 1,
      label: 'Disciplines',
      hint: `${disciplines.length} discipline${disciplines.length === 1 ? '' : 's'}`,
      done: disciplines.length > 0,
    },
    {
      key: 2,
      label: 'Divisions',
      hint: `${divisions.length} division${divisions.length === 1 ? '' : 's'}`,
      done: divisions.length > 0,
    },
    {
      key: 3,
      label: 'Classes',
      hint: `${classes.length} class${classes.length === 1 ? '' : 'es'}`,
      done: classes.length > 0,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: COLORS.muted }}>
        Class setup is configured. Click a section to make changes.
      </p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onEdit(item.key)}
              className="w-full flex items-start justify-between gap-3 p-4 rounded-lg border text-left transition-colors hover:bg-amber-50"
              style={{
                borderColor: item.done ? '#bcd9c0' : COLORS.border,
                backgroundColor: item.done ? '#f3faf3' : COLORS.bg,
              }}
            >
              <div>
                <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
                  {item.label}
                </h2>
                <p className="text-sm mt-0.5" style={{ color: COLORS.muted }}>{item.hint}</p>
              </div>
              <span
                className="text-xs px-2 py-1 rounded shrink-0"
                style={{
                  color: item.done ? '#1f4e1f' : COLORS.warn,
                  backgroundColor: item.done ? '#dff1df' : COLORS.warnSoft,
                }}
              >
                {item.done ? 'Edit' : 'Open'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────────────

function Stepper({
  step,
  steps,
  onJump,
}: {
  step: Step;
  steps: { key: Step; label: string; done: boolean }[];
  onJump: (target: Step) => void;
}) {
  return (
    <nav aria-label="Class setup steps" className="overflow-x-auto">
      <ol className="flex items-center gap-2 text-sm whitespace-nowrap">
        {steps.map((s, idx) => {
          const isCurrent = s.key === step;
          const badge = s.done ? '✓' : String(s.key);
          const badgeColor = s.done ? COLORS.done : isCurrent ? COLORS.warn : COLORS.muted;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onJump(s.key)}
                className="flex items-center gap-1.5"
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span
                  aria-hidden
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: badgeColor, color: '#fff' }}
                >
                  {badge}
                </span>
                <span
                  style={{
                    color: isCurrent ? COLORS.text : COLORS.muted,
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {s.label}
                </span>
              </button>
              {idx < steps.length - 1 && (
                <span aria-hidden style={{ color: COLORS.border }}>
                  ─
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Step footer ────────────────────────────────────────────────────────────────

/**
 * The save/finish bar every step ends with. It sticks to the bottom of the
 * viewport because the standard libraries and the class matrix are long enough
 * to push a static footer out of sight — and a save button you have to scroll
 * to find reads as a save button that doesn't exist.
 */
function StepFooter({
  onBack,
  onAction,
  actionLabel,
  disabled,
  hint,
}: {
  onBack?: () => void;
  onAction: () => void;
  actionLabel: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div
      className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 border-t flex items-center justify-between gap-3 flex-wrap"
      style={{
        borderColor: COLORS.border,
        backgroundColor: COLORS.bg,
        // Reads as a bar floating over the content it covers mid-scroll,
        // rather than a row that has cut the matrix in half.
        boxShadow: '0 -2px 6px rgba(44, 24, 16, 0.08)',
      }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
        >
          ← Back
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3">
        {hint && (
          <span className="text-xs" style={{ color: COLORS.muted }}>
            {hint}
          </span>
        )}
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Disciplines ────────────────────────────────────────────────────────

function DisciplineStep({
  mode,
  showId,
  existing,
  standardOptions,
  busy,
  setBusy,
  setError,
  onRefreshed,
  onSaved,
}: {
  mode: Mode;
  showId: string;
  existing: DisciplineItem[];
  standardOptions: StandardItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onRefreshed: (rows: DisciplineItem[]) => void;
  onSaved: (rows: DisciplineItem[]) => void;
}) {
  const existingNames = useMemo(
    () => new Set(existing.map((d) => d.name.trim().toLowerCase())),
    [existing],
  );
  const available = useMemo(
    () => standardOptions.filter((o) => !existingNames.has(o.name.trim().toLowerCase())),
    [standardOptions, existingNames],
  );

  const [checkedStandard, setCheckedStandard] = useState<Set<string>>(new Set());
  const [customDraft, setCustomDraft] = useState('');
  const [customAdds, setCustomAdds] = useState<string[]>([]);

  function toggle(name: string) {
    setCheckedStandard((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customDraft.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (existingNames.has(lower) || customAdds.some((n) => n.toLowerCase() === lower)) {
      setCustomDraft('');
      return;
    }
    setCustomAdds((prev) => [...prev, name]);
    setCustomDraft('');
  }

  function removeCustom(name: string) {
    setCustomAdds((prev) => prev.filter((n) => n !== name));
  }

  const newNames = [...Array.from(checkedStandard), ...customAdds];

  async function save() {
    setError(null);
    if (newNames.length === 0 && existing.length === 0) {
      setError('Pick at least one discipline (or add a custom one).');
      return;
    }
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

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Step 1: Disciplines
        </h2>
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          The overarching style of riding offered at this show. Pick from the
          standard list, add your own, or both.
        </p>
      </div>

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
                style={{ borderColor: '#bcd9c0', backgroundColor: '#f3faf3', color: COLORS.done }}
              >
                ✓ {d.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await fetch(`/api/shows/${showId}/disciplines/${d.id}`, { method: 'DELETE' });
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
                  }}
                  aria-label={`Remove ${d.name}`}
                  title={d.class_count ? `Cannot remove — ${d.class_count} class${d.class_count === 1 ? '' : 'es'} use this discipline` : `Remove ${d.name}`}
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
          Standard library (AQHA / APHA shared)
        </p>
        <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
          Click an item to add it to the show; click again to remove it.
        </p>
        {available.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            All standard disciplines have already been added. Use custom below for
            anything else.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((opt) => {
              const selected = checkedStandard.has(opt.name);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.name)}
                  aria-pressed={selected}
                  className="text-sm rounded px-3 py-1.5 border"
                  style={{
                    borderColor: selected ? COLORS.warn : COLORS.border,
                    backgroundColor: selected ? COLORS.highlight : '#fff',
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
          Custom disciplines
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {customAdds.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 border border-dashed"
              style={{ borderColor: '#bca15f', backgroundColor: COLORS.highlight, color: COLORS.warn }}
            >
              {n}
              <button
                type="button"
                onClick={() => removeCustom(n)}
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
            placeholder="Add custom discipline…"
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
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
          >
            Add
          </button>
        </div>
      </div>

      <StepFooter
        onAction={save}
        disabled={busy}
        actionLabel={busy ? 'Saving…' : mode === 'hub' ? 'Save changes' : 'Save & continue →'}
        hint={
          newNames.length > 0
            ? `${newNames.length} to add`
            : mode === 'hub'
              ? undefined
              : `${existing.length} selected`
        }
      />
    </section>
  );
}

// ── Step 2: Divisions ──────────────────────────────────────────────────────────

function DivisionStep({
  mode,
  showId,
  disciplines,
  existing,
  standardOptions,
  busy,
  setBusy,
  setError,
  onBack,
  onRefreshed,
  onSaved,
}: {
  mode: Mode;
  showId: string;
  disciplines: DisciplineItem[];
  existing: DivisionItem[];
  standardOptions: StandardItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onBack?: () => void;
  onRefreshed: (rows: DivisionItem[]) => void;
  onSaved: (rows: DivisionItem[]) => void;
}) {
  const existingNames = useMemo(
    () => new Set(existing.map((d) => d.name.trim().toLowerCase())),
    [existing],
  );
  const available = useMemo(
    () => standardOptions.filter((o) => !existingNames.has(o.name.trim().toLowerCase())),
    [standardOptions, existingNames],
  );

  const [checkedStandard, setCheckedStandard] = useState<Set<string>>(new Set());
  const [customDraft, setCustomDraft] = useState('');
  const [customAdds, setCustomAdds] = useState<string[]>([]);

  function toggle(name: string) {
    setCheckedStandard((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customDraft.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (existingNames.has(lower) || customAdds.some((n) => n.toLowerCase() === lower)) {
      setCustomDraft('');
      return;
    }
    setCustomAdds((prev) => [...prev, name]);
    setCustomDraft('');
  }

  function removeCustom(name: string) {
    setCustomAdds((prev) => prev.filter((n) => n !== name));
  }

  const newNames = [...Array.from(checkedStandard), ...customAdds];

  async function save() {
    setError(null);
    if (newNames.length === 0 && existing.length === 0) {
      setError('Pick at least one division (or add a custom one).');
      return;
    }
    setBusy(true);
    try {
      if (newNames.length > 0) {
        // Wire new divisions to every existing discipline so the (Discipline,
        // Division) pair is registered for any Step-3 class composition.
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

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Step 2: Divisions
        </h2>
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          The age, skill, or horse-age bracket. Each division you add will be
          available under every discipline you selected.
        </p>
      </div>

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
                style={{ borderColor: '#bcd9c0', backgroundColor: '#f3faf3', color: COLORS.done }}
              >
                ✓ {d.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await fetch(`/api/shows/${showId}/divisions/${d.id}`, { method: 'DELETE' });
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
                  }}
                  aria-label={`Remove ${d.name}`}
                  title={d.class_count ? `Cannot remove — ${d.class_count} class${d.class_count === 1 ? '' : 'es'} use this division` : `Remove ${d.name}`}
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
          Standard library (AQHA / APHA shared)
        </p>
        <p className="text-xs mb-2" style={{ color: COLORS.muted }}>
          Click an item to add it to the show; click again to remove it.
        </p>
        {available.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            All standard divisions have already been added. Use custom below for
            anything else.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((opt) => {
              const selected = checkedStandard.has(opt.name);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.name)}
                  aria-pressed={selected}
                  className="text-sm rounded px-3 py-1.5 border"
                  style={{
                    borderColor: selected ? COLORS.warn : COLORS.border,
                    backgroundColor: selected ? COLORS.highlight : '#fff',
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
          Custom divisions
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {customAdds.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 border border-dashed"
              style={{ borderColor: '#bca15f', backgroundColor: COLORS.highlight, color: COLORS.warn }}
            >
              {n}
              <button
                type="button"
                onClick={() => removeCustom(n)}
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
            placeholder="Add custom division…"
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
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
          >
            Add
          </button>
        </div>
      </div>

      <StepFooter
        onBack={onBack}
        onAction={save}
        disabled={busy}
        actionLabel={busy ? 'Saving…' : mode === 'hub' ? 'Save changes' : 'Save & continue →'}
        hint={
          newNames.length > 0
            ? `${newNames.length} to add`
            : mode === 'hub'
              ? undefined
              : `${existing.length} selected`
        }
      />
    </section>
  );
}

// ── Step 3: Classes ────────────────────────────────────────────────────────────

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

function ClassesStep({
  mode,
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
  onDone,
}: {
  mode: Mode;
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
  onBack?: () => void;
  onDone?: () => void;
}) {
  const [classDate, setClassDate] = useState(showStartDate);
  // The schedule can run to hundreds of rows; it lives below the picker and
  // stays folded so the matrix — the thing being worked in — owns the screen.
  const [listOpen, setListOpen] = useState(false);
  // Date-qualified cell keys (`${classDate}::${disciplineId}::${divisionId}`)
  // for picks that have been clicked but whose create hasn't reconciled into
  // `classes` yet — drives the in-flight "…" marker on the matrix.
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
  const [savingOrder, setSavingOrder] = useState(false);

  // Serialize class creates: clicking "+" enqueues a job and a single drainer
  // POSTs them one at a time, so the backend's per-create renumber can't race
  // with itself when the secretary clicks several cells quickly.
  const queueRef = useRef<{ disciplineId: string; divisionId: string; classDate: string }[]>([]);
  const processingRef = useRef(false);

  const disciplineById = useMemo(
    () => new Map(disciplines.map((d) => [d.id, d])),
    [disciplines],
  );
  const divisionById = useMemo(
    () => new Map(divisions.map((d) => [d.id, d])),
    [divisions],
  );

  // Existing-class (discipline, division) pairs scoped to the selected date.
  // Cells in that set are disabled in the matrix so the secretary can't
  // queue a duplicate for that day.
  const takenForDate = useMemo(
    () =>
      new Set(
        classes
          .filter((c) => c.class_date === classDate)
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

  async function refreshClasses() {
    const res = await fetch(`/api/shows/${showId}/classes`, { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as ClassItem[];
      onChanged(json);
    }
  }

  // Drag-and-drop reorder, scoped to a single day. Reordering one day reshuffles
  // the global class-number sequence (numbers run 1..N across the whole show,
  // ordered by date then position), so we persist the full ordered id list.
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

    // Optimistically renumber to match the new global position so the list
    // doesn't flash stale numbers while the save is in flight.
    const renumbered = reordered.map((c, i) => ({
      ...c,
      sort_order: i + 1,
      class_number: String(i + 1),
    }));
    onChanged(renumbered);

    setError(null);
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

  function changeDate(d: string) {
    setClassDate(d);
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

  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Step 3: Classes
        </h2>
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          Pick a date, then click each (Division × Discipline) cell to add it as
          a class right away. Each class is named{' '}
          <em>&quot;{`{Division} {Discipline}`}&quot;</em> and auto-numbered.
        </p>
      </div>

      {/* ── Builder ───────────────────────────────────────────────────── */}
      <div
        className="rounded border p-3 space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
      >
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
              Class date
            </span>
            <select
              value={classDate}
              onChange={(e) => changeDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            >
              {enumerateDates(showStartDate, showEndDate).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Cells marked{' '}
            <span style={{ color: COLORS.muted, fontWeight: 600 }}>✓</span> are
            already a class on the selected date.
          </p>
        </div>

        {noBuildingBlocks ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            Add at least one discipline and one division in the previous steps
            to build classes here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-10 text-left font-semibold pr-3 pb-2 border-b"
                    style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.text }}
                  >
                    Division ╲ Discipline
                  </th>
                  {disciplines.map((disc) => (
                    <th
                      key={disc.id}
                      className="font-medium text-xs px-2 pb-2 border-b text-center"
                      style={{ borderColor: COLORS.border, color: COLORS.warn, minWidth: '5rem' }}
                      title={disc.name}
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
                        ? `Already on the schedule for ${classDate}`
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
                                ? '#e8e0d0'
                                : queued
                                  ? COLORS.highlight
                                  : '#fff',
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
          </div>
        )}

        {queuedKeys.size > 0 && (
          <p className="text-xs font-medium pt-1" style={{ color: COLORS.warn }}>
            Adding {queuedKeys.size} class{queuedKeys.size === 1 ? '' : 'es'}…
          </p>
        )}
      </div>

      {/* ── The schedule so far ───────────────────────────────────────────
          Below the picker and folded by default: a built-out show runs to
          hundreds of classes, and the matrix is what the secretary is working
          in. The count in the header is the live feedback that a click landed;
          the ✓ on the matrix cell is the other half. */}
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
            style={{ borderColor: COLORS.border, backgroundColor: '#fff', color: COLORS.text }}
          >
            <span className="font-medium">
              <span aria-hidden>{listOpen ? '▾' : '▸'}</span> Classes added ({classes.length})
            </span>
            <span className="text-xs" style={{ color: COLORS.muted }}>
              {listOpen ? 'Hide' : 'Show, reorder, or delete'}
            </span>
          </button>

          {listOpen && (
            <DragDropContext onDragEnd={handleDragEnd}>
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
                                    <span className="font-mono shrink-0" style={{ color: '#8b4513' }}>
                                      #{c.class_number}
                                    </span>
                                    <span className="truncate">{c.class_name}</span>
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => removeClass(c.id)}
                                    className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0"
                                  >
                                    Delete
                                  </button>
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

      {/* Classes save as they are clicked, so this finishes the step rather
          than saving it — but the step still needs a way out that isn't the
          browser's back button. */}
      <StepFooter
        onBack={onBack}
        onAction={onDone ?? (() => undefined)}
        disabled={busy || queuedKeys.size > 0 || !onDone}
        actionLabel={
          queuedKeys.size > 0
            ? 'Adding…'
            : mode === 'hub'
              ? 'Done — back to overview'
              : 'Finish class setup →'
        }
        hint={`${classes.length} class${classes.length === 1 ? '' : 'es'} saved`}
      />
    </section>
  );
}
