'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [step, setStep] = useState<Step>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [disciplines, setDisciplines] = useState<DisciplineItem[]>(initialDisciplines);
  const [divisions, setDivisions] = useState<DivisionItem[]>(initialDivisions);
  const [classes, setClasses] = useState<ClassItem[]>(initialClasses);

  return (
    <div className="space-y-6">
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

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
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
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onSaved={(rows) => {
            setDisciplines(rows);
            setStep(2);
            router.refresh();
          }}
        />
      )}
      {step === 2 && (
        <DivisionStep
          showId={showId}
          disciplines={disciplines}
          existing={divisions}
          standardOptions={standardDivisions}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onBack={() => setStep(1)}
          onSaved={(rows) => {
            setDivisions(rows);
            setStep(3);
            router.refresh();
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
          onBack={() => setStep(2)}
          onDone={() => router.push(`/admin/shows/${showId}`)}
        />
      )}
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

// ── Step 1: Disciplines ────────────────────────────────────────────────────────

function DisciplineStep({
  showId,
  existing,
  standardOptions,
  busy,
  setBusy,
  setError,
  onSaved,
}: {
  showId: string;
  existing: DisciplineItem[];
  standardOptions: StandardItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
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
                className="text-xs rounded px-2 py-1 border"
                style={{ borderColor: '#bcd9c0', backgroundColor: '#f3faf3', color: COLORS.done }}
              >
                ✓ {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
          Standard library (AQHA / APHA shared)
        </p>
        {available.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            All standard disciplines have already been added. Use custom below for
            anything else.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-1">
            {available.map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: COLORS.text }}
              >
                <input
                  type="checkbox"
                  checked={checkedStandard.has(opt.name)}
                  onChange={() => toggle(opt.name)}
                />
                {opt.name}
              </label>
            ))}
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

      <div className="flex justify-end pt-2 border-t" style={{ borderColor: COLORS.border }}>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </section>
  );
}

// ── Step 2: Divisions ──────────────────────────────────────────────────────────

function DivisionStep({
  showId,
  disciplines,
  existing,
  standardOptions,
  busy,
  setBusy,
  setError,
  onBack,
  onSaved,
}: {
  showId: string;
  disciplines: DisciplineItem[];
  existing: DivisionItem[];
  standardOptions: StandardItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (msg: string | null) => void;
  onBack: () => void;
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
                className="text-xs rounded px-2 py-1 border"
                style={{ borderColor: '#bcd9c0', backgroundColor: '#f3faf3', color: COLORS.done }}
              >
                ✓ {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium mb-1" style={{ color: COLORS.muted }}>
          Standard library (AQHA / APHA shared)
        </p>
        {available.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            All standard divisions have already been added. Use custom below for
            anything else.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-1">
            {available.map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: COLORS.text }}
              >
                <input
                  type="checkbox"
                  checked={checkedStandard.has(opt.name)}
                  onChange={() => toggle(opt.name)}
                />
                {opt.name}
              </label>
            ))}
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

      <div className="flex justify-between pt-2 border-t" style={{ borderColor: COLORS.border }}>
        <button
          type="button"
          onClick={onBack}
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </section>
  );
}

// ── Step 3: Classes ────────────────────────────────────────────────────────────

function cellKey(disciplineId: string, divisionId: string): string {
  return `${disciplineId}::${divisionId}`;
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
  onDone: () => void;
}) {
  const [classDate, setClassDate] = useState(showStartDate);
  const [pending, setPending] = useState<Set<string>>(new Set());

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

  function toggleCell(disciplineId: string, divisionId: string) {
    const k = cellKey(disciplineId, divisionId);
    if (takenForDate.has(k)) return;
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function changeDate(d: string) {
    setClassDate(d);
    // Pairs already-taken depend on the date, so clear the basket on date
    // change. Keeping it would silently drop "taken" picks at submit time.
    setPending(new Set());
  }

  async function addAll() {
    if (pending.size === 0) return;
    setError(null);
    setBusy(true);
    let createdAny = false;
    try {
      // Sequential so the backend's per-create renumber doesn't race with
      // itself. The basket is small (handful of picks) so this is fine.
      for (const k of Array.from(pending)) {
        const [discId, divId] = k.split('::');
        const disc = disciplineById.get(discId);
        const div = divisionById.get(divId);
        if (!disc || !div) continue;
        const className = `${div.name} ${disc.name}`;
        const res = await fetch(`/api/shows/${showId}/classes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            discipline_id: discId,
            division_id: divId,
            class_name: className,
            class_date: classDate,
            status: 'OPEN',
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setError(j?.detail || `Failed to create "${className}".`);
          if (createdAny) await refreshClasses();
          return;
        }
        createdAny = true;
      }
      await refreshClasses();
      setPending(new Set());
    } finally {
      setBusy(false);
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
          Pick a date, then check each (Discipline × Division) cell you want to
          turn into a class. Selected pairs collect into a batch — click{' '}
          <strong>Add</strong> once you&apos;ve picked them all. Each class is named{' '}
          <em>&quot;{`{Division} {Discipline}`}&quot;</em> and auto-numbered.
        </p>
      </div>

      {/* ── Existing classes ──────────────────────────────────────────── */}
      {classes.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No classes yet.
        </p>
      ) : (
        <div className="space-y-3">
          {classesByDate.map(([date, dayClasses]) => (
            <div key={date}>
              <p
                className="text-xs font-medium mb-1"
                style={{ color: COLORS.muted }}
              >
                {date} — {dayClasses.length} class
                {dayClasses.length === 1 ? '' : 'es'}
              </p>
              <ul className="space-y-1">
                {dayClasses.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 text-sm border-b py-1"
                    style={{ borderColor: COLORS.borderSoft }}
                  >
                    <span style={{ color: COLORS.text }}>
                      <span className="font-mono mr-2" style={{ color: '#8b4513' }}>
                        #{c.class_number}
                      </span>
                      {c.class_name}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeClass(c.id)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

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
            <input
              type="date"
              value={classDate}
              min={showStartDate}
              max={showEndDate}
              onChange={(e) => changeDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
          </label>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Show runs {showStartDate} → {showEndDate}. Cells marked{' '}
            <span style={{ color: COLORS.warn, fontWeight: 600 }}>exists</span> are
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
                    Discipline ╲ Division
                  </th>
                  {divisions.map((div) => (
                    <th
                      key={div.id}
                      className="font-medium text-xs px-2 pb-2 border-b text-center"
                      style={{ borderColor: COLORS.border, color: COLORS.warn, minWidth: '5rem' }}
                      title={div.name}
                    >
                      {div.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disciplines.map((disc) => (
                  <tr key={disc.id}>
                    <th
                      className="sticky left-0 z-10 text-left font-normal pr-3 py-1.5 border-b"
                      style={{
                        borderColor: COLORS.borderSoft,
                        backgroundColor: COLORS.warnSoft,
                        color: COLORS.text,
                      }}
                      scope="row"
                    >
                      {disc.name}
                    </th>
                    {divisions.map((div) => {
                      const k = cellKey(disc.id, div.id);
                      const taken = takenForDate.has(k);
                      const picked = pending.has(k);
                      const title = taken
                        ? `Already on the schedule for ${classDate}`
                        : picked
                          ? `Selected: ${div.name} ${disc.name}`
                          : `Add ${div.name} ${disc.name}`;
                      return (
                        <td
                          key={div.id}
                          className="text-center border-b p-0.5"
                          style={{ borderColor: COLORS.borderSoft }}
                        >
                          <button
                            type="button"
                            disabled={taken}
                            onClick={() => toggleCell(disc.id, div.id)}
                            title={title}
                            aria-label={title}
                            className="w-full text-xs font-medium rounded px-2 py-1"
                            style={{
                              backgroundColor: taken
                                ? '#e8e0d0'
                                : picked
                                  ? COLORS.highlight
                                  : '#fff',
                              color: taken
                                ? COLORS.muted
                                : picked
                                  ? COLORS.warn
                                  : COLORS.text,
                              border: picked
                                ? `1px solid ${COLORS.warn}`
                                : `1px solid ${COLORS.border}`,
                              cursor: taken ? 'not-allowed' : 'pointer',
                              minWidth: '3.5rem',
                            }}
                          >
                            {taken ? 'exists' : picked ? '✓' : '+'}
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

        {pending.size > 0 && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: COLORS.border }}>
            <p className="text-xs font-medium" style={{ color: COLORS.warn }}>
              Selected for {classDate} — {pending.size} class
              {pending.size === 1 ? '' : 'es'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(pending).map((k) => {
                const [discId, divId] = k.split('::');
                const disc = disciplineById.get(discId);
                const div = divisionById.get(divId);
                if (!disc || !div) return null;
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1.5 text-xs rounded px-2 py-1 border"
                    style={{
                      borderColor: COLORS.warn,
                      backgroundColor: COLORS.highlight,
                      color: COLORS.warn,
                    }}
                  >
                    {div.name} {disc.name}
                    <button
                      type="button"
                      onClick={() => toggleCell(discId, divId)}
                      aria-label={`Remove ${div.name} ${disc.name}`}
                      className="text-xs leading-none"
                      style={{ color: COLORS.muted }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={addAll}
            disabled={busy || pending.size === 0}
            className="text-sm rounded px-4 py-2 disabled:opacity-50"
            style={{ backgroundColor: COLORS.warn, color: '#fff' }}
          >
            {busy
              ? 'Adding…'
              : pending.size === 0
                ? 'Add'
                : `Add ${pending.size} class${pending.size === 1 ? '' : 'es'}`}
          </button>
        </div>
      </div>

      <div className="flex justify-between pt-2 border-t" style={{ borderColor: COLORS.border }}>
        <button
          type="button"
          onClick={onBack}
          className="text-sm rounded px-3 py-2 border"
          style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-sm rounded px-4 py-2"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          Done →
        </button>
      </div>
    </section>
  );
}
