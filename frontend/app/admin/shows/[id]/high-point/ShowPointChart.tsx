'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import {
  awardsFromChart,
  blankChart,
  chartDraftFrom,
  type ChartDraft,
  type PointSystem,
} from '@/lib/high-point';
import { ChartGridEditor, ChartPreview } from '@/components/PointChart';
import { useRegisterStepAutosave } from '../setup/_lib/StepAutosave';

export type AssociationOption = { id: string; code: string; name: string };

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;
const quietButton = { borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' } as const;
const panelStyle = { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--background)' } as const;

type Draft = { name: string; associationId: string; notes: string; chart: ChartDraft };

/** `custom`: built from scratch with *Create a custom High Point System*, so
 *  saving it also adds it to the company's templates. */
type Mode =
  | { kind: 'view' }
  | { kind: 'choose' }
  | { kind: 'edit'; draft: Draft; startedFrom: string | null; custom: boolean };

function draftOf(system: PointSystem): Draft {
  return {
    name: system.name,
    associationId: system.association_id ?? '',
    notes: system.notes ?? '',
    chart: chartDraftFrom(system.awards),
  };
}

function badgeFor(
  system: PointSystem,
  showId: string,
  isAdmin: boolean,
  templates: PointSystem[],
): string | null {
  if (system.show_id === showId) return 'This show’s own chart';
  if (system.standard) return 'GaitDesk standard';
  if (isAdmin) return system.company_name;
  // A show a co-manager from another company set up may score by a system this
  // caller cannot see in their own list; say so rather than claim it is theirs.
  return templates.some((t) => t.id === system.id) ? 'Your company’s' : 'Another company’s';
}

/**
 * The show's points chart (migration 153).
 *
 * A show used to pick one system from a dropdown and see nothing of it. Now the
 * office picks a template — a GaitDesk standard chart or one of its company's —
 * sees the chart before choosing it, and presses *Use this template* to open it
 * as a grid it can change. Saving keeps that grid as **the show's own chart**:
 * a copy, so the template is untouched and a later change to the template does
 * not move this show's standings.
 *
 * **Building one from scratch is its own button**, *Create a custom High Point
 * System*, not an entry at the top of the template list where it was easy to
 * miss. Saving a chart built that way also adds it to the company's templates
 * (`save_as_template`; the backend's `template_company` says whose), so the
 * next show starts from it — and no other company's list ever shows it.
 *
 * A show still scoring by a library system as it stands (every show set up
 * before this) keeps it, shown the same way, with *Customize for this show* to
 * take a copy.
 *
 * Rendered in two places: the Scoring step of setup and the High Point page the
 * dashboard tile opens. In the step, **leaving saves an open editor** the way
 * every step does (`StepAutosave`) — but only when there is something to save:
 * a template just opened, or a chart that differs from the one the show has.
 * Outside the wizard the registration does nothing and the Save button is the
 * only way.
 */
export default function ShowPointChart({
  showId,
  showName,
  templates,
  current,
  associations,
  isAdmin,
}: {
  showId: string;
  showName: string;
  /** The library systems the caller may start from: GaitDesk standard ones and
   *  their company's (every company's, for an admin). */
  templates: PointSystem[];
  current: PointSystem | null;
  associations: AssociationOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(current ? { kind: 'view' } : { kind: 'choose' });
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  const isOwn = current?.show_id === showId;
  const standard = templates.filter((t) => t.standard);
  const companies = templates.filter((t) => !t.standard);
  const chosen = choice ? templates.find((t) => t.id === choice) ?? null : null;

  const openEditor = (from: PointSystem, startedFrom: string | null) => {
    setError(null);
    setNotice(null);
    setMode({ kind: 'edit', startedFrom, custom: false, draft: draftOf(from) });
  };

  const openCustom = () => {
    setError(null);
    setNotice(null);
    setMode({
      kind: 'edit',
      startedFrom: null,
      custom: true,
      draft: { name: `${showName} High Point`, associationId: '', notes: '', chart: blankChart() },
    });
  };

  // What an open editor is compared against to decide whether leaving the step
  // has anything to save: the show's own chart as saved. A template or a
  // library system opened for the show has no baseline — it is unsaved work.
  const baseline = isOwn && current ? JSON.stringify(draftOf(current)) : null;

  const updateDraft = (patch: Partial<Draft>) =>
    setMode((m) => (m.kind === 'edit' ? { ...m, draft: { ...m.draft, ...patch } } : m));

  const cancel = () => {
    setError(null);
    setChoice('');
    setMode(current ? { kind: 'view' } : { kind: 'choose' });
  };

  /** Write the draft as the show's chart — and, for one built from scratch, as
   *  a company template too. False when it could not be, with the reason on
   *  screen. */
  const persist = async (draft: Draft, custom: boolean): Promise<boolean> => {
    if (!draft.name.trim()) {
      setError('Give the chart a name — it is printed at the top of the leaderboard.');
      return false;
    }
    const chart = awardsFromChart(draft.chart);
    if ('error' in chart) {
      setError(chart.error);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/high-point/chart`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          association_id: draft.associationId || null,
          notes: draft.notes.trim() || null,
          awards: chart.awards,
          save_as_template: custom,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'The chart could not be saved.'));
        return false;
      }
      const saved = body as {
        template?: { name: string; company_name: string | null } | null;
        template_skipped?: string | null;
      } | null;
      if (saved?.template) {
        setNotice({
          tone: 'success',
          text:
            `Saved. “${saved.template.name}” is now in ${saved.template.company_name ?? 'your company'}’s templates, ` +
            'ready for your next show — no other show company can see it.',
        });
      } else if (saved?.template_skipped) {
        // Asked for a template and none could be made: say so, or the save
        // reads as having failed.
        setNotice({ tone: 'warning', text: saved.template_skipped });
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (mode.kind !== 'edit') return;
    if (await persist(mode.draft, mode.custom)) {
      setChoice('');
      setMode({ kind: 'view' });
      router.refresh();
    }
  };

  // Leaving the Scoring step with the editor open saves it, like every step;
  // a no-op when nothing differs from the show's saved chart.
  useRegisterStepAutosave(
    async () => {
      if (mode.kind !== 'edit') return;
      if (baseline !== null && JSON.stringify(mode.draft) === baseline) return;
      if (!(await persist(mode.draft, mode.custom))) throw new Error('The chart could not be saved.');
    },
    () => mode.kind === 'edit' && (baseline === null || JSON.stringify(mode.draft) !== baseline),
  );

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/high-point`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point_system_id: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(errorMessage(body, 'High point could not be turned off.'));
        return;
      }
      setConfirmOff(false);
      setMode({ kind: 'choose' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  // ── Editing ────────────────────────────────────────────────────────────────
  if (mode.kind === 'edit') {
    const { draft } = mode;
    return (
      <div className="space-y-4">
        <p className="text-sm" style={labelStyle}>
          {mode.startedFrom
            ? <>Starting from <strong>{mode.startedFrom}</strong>. Change anything you need for this show — the template itself is not changed.</>
            : mode.custom
              ? <>A High Point System of your own, from scratch. Add a row per range of class sizes and the points each place earns. Saving also adds it to your company&apos;s templates under this name, so your next show can start from it — no other show company can see it.</>
              : <>Change anything you need for this show.</>}
          {isOwn && ' Saving replaces the chart this show uses now.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Name</span>
            <input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
              maxLength={200}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Whose rules</span>
            <select
              value={draft.associationId}
              onChange={(e) => updateDraft({ associationId: e.target.value })}
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            >
              <option value="">None — this show&apos;s own scale</option>
              {associations.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => updateDraft({ notes: e.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="Printed under the leaderboard — say where the chart comes from, and what you changed."
            className="border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
        </label>

        <ChartGridEditor chart={draft.chart} onChange={(chart) => updateDraft({ chart })} />

        {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
            {busy ? 'Saving…' : 'Save chart for this show'}
          </button>
          <button type="button" onClick={cancel} disabled={busy} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── The chart in use, and choosing a template ──────────────────────────────
  return (
    <div className="space-y-4">
      {/* What the last save did about templates — first, where it is read. */}
      {notice && !error && (
        <p
          className="text-sm rounded px-3 py-2"
          role="status"
          style={
            notice.tone === 'success'
              ? { color: 'var(--success-strong)', backgroundColor: 'var(--success-bg)' }
              : { color: 'var(--text-deep)', backgroundColor: 'var(--warning-bg)' }
          }
        >
          {notice.text}
        </p>
      )}
      {current && (
        <div className="space-y-3">
          <div>
            <p className="text-sm" style={labelStyle}>
              Your current point system being used:{' '}
              <span className="font-semibold text-base" style={{ color: 'var(--foreground)' }}>{current.name}</span>
              {badgeFor(current, showId, isAdmin, templates) && (
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-hover)' }}>
                  {badgeFor(current, showId, isAdmin, templates)}
                </span>
              )}
            </p>
            {current.notes && <p className="text-sm mt-1" style={labelStyle}>{current.notes}</p>}
          </div>
          {/* The chart's own controls sit directly above it, against the left
              edge — on the desktop layout, right-aligned put them a screen's
              width away from the chart they change. */}
          {mode.kind === 'view' && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => openEditor(current, isOwn ? null : current.name)}
                className="px-3 py-1.5 rounded text-sm font-medium"
                style={primaryButton}
                title={isOwn ? 'Change this show’s chart' : 'Take a copy of this chart for this show and change it'}
              >
                {isOwn ? 'Edit chart' : 'Customize for this show'}
              </button>
              <button
                type="button"
                onClick={() => { setChoice(''); setNotice(null); setMode({ kind: 'choose' }); }}
                className="px-3 py-1.5 rounded border text-sm font-medium"
                style={quietButton}
              >
                Use a pre-built template
              </button>
              <button
                type="button"
                onClick={openCustom}
                className="px-3 py-1.5 rounded border text-sm font-medium"
                style={quietButton}
                title="Build a new chart from scratch for this show — it is also added to your company’s templates"
              >
                Create a custom High Point System
              </button>
            </div>
          )}
          <ChartPreview awards={current.awards} />
        </div>
      )}

      {/* With no chart yet, building one from scratch is offered on its own,
          ahead of the templates — not as the first line of their list. */}
      {mode.kind === 'choose' && !current && (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={openCustom} className="px-4 py-2 rounded text-sm font-medium" style={primaryButton}>
            Create a custom High Point System
          </button>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Built from scratch, and added to your company&apos;s templates for next time. Or start from a pre-built template below.
          </span>
        </div>
      )}

      {mode.kind === 'choose' && (
        <div className="rounded-lg border p-3 space-y-3" style={panelStyle}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
              Pre-built templates
            </span>
            <select
              value={choice}
              onChange={(e) => { setChoice(e.target.value); setError(null); }}
              className="border rounded px-3 py-2 text-sm min-w-0 max-w-full"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            >
              <option value="">Choose a template…</option>
              {standard.length > 0 && (
                <optgroup label="GaitDesk standard">
                  {standard.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              )}
              {companies.length > 0 && (
                <optgroup label={isAdmin ? 'Show companies' : 'Your company'}>
                  {companies.map((t) => (
                    <option key={t.id} value={t.id}>
                      {isAdmin && t.company_name ? `${t.name} — ${t.company_name}` : t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          {chosen && (
            <div className="space-y-2">
              {chosen.notes && <p className="text-sm" style={labelStyle}>{chosen.notes}</p>}
              <ChartPreview awards={chosen.awards} />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => openEditor(chosen, chosen.name)}
                  className="px-4 py-2 rounded text-sm font-medium"
                  style={primaryButton}
                >
                  Use this template
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Opens it as this show&apos;s own chart, ready to change before you save it.
                </span>
              </div>
            </div>
          )}

          {current && (
            <button type="button" onClick={cancel} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Keep the current chart
            </button>
          )}
        </div>
      )}

      {current && mode.kind === 'view' && (
        <div className="text-sm">
          {confirmOff ? (
            <span className="flex items-center gap-3 flex-wrap">
              <span style={labelStyle}>
                Turn off high point at this show?{isOwn && ' Its chart is deleted — a template stays in the list.'}
              </span>
              <button type="button" onClick={turnOff} disabled={busy} className="font-medium hover:underline" style={{ color: 'var(--error)' }}>
                {busy ? 'Turning off…' : 'Turn off'}
              </button>
              <button type="button" onClick={() => setConfirmOff(false)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmOff(true)} className="hover:underline" style={{ color: 'var(--error)' }}>
              Turn off high point
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
