'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import {
  awardsFromChart,
  blankChart,
  chartDraftFrom,
  type ChartDraft,
  type PointSystem,
  type PointSystemOwner,
} from '@/lib/high-point';
import { ChartGridEditor, ChartPreview } from '@/components/PointChart';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;

export type AssociationOption = { id: string; code: string; name: string };

type Draft = {
  id: string | null;
  name: string;
  /** '' is no company: a system only GaitDesk admins can use. */
  companyId: string;
  associationId: string;
  notes: string;
  chart: ChartDraft;
};

function draftFrom(system: PointSystem): Draft {
  return {
    id: system.id,
    name: system.name,
    companyId: system.company_id ?? '',
    associationId: system.association_id ?? '',
    notes: system.notes ?? '',
    chart: chartDraftFrom(system.awards),
  };
}

/**
 * Points systems (migrations 147, 148): the charts that turn a posted placing
 * into high-point points, each kept by a show company for its own shows. A
 * GaitDesk admin sees every company's, and may keep one under no company,
 * which only admins can use. Each association scores its own way, usually scaled by
 * class size, so a chart is a grid — a row per class size the rules name, a
 * column per place. A flat scale is one row starting at 1. The largest row at
 * or below a class's size applies, which is how a printed chart's "11 or more
 * horses" row reads.
 *
 * The grid itself is `ChartGridEditor`, shared with a show's own chart on its
 * High Point page (migration 153), so the two cannot disagree about what a row
 * means.
 */
export default function PointSystemsManager({
  initialSystems,
  associations,
  owners,
  isAdmin,
}: {
  initialSystems: PointSystem[];
  associations: AssociationOption[];
  /** The companies the caller may keep a system under, organizations first. */
  owners: PointSystemOwner[];
  isAdmin: boolean;
}) {
  // Somebody in one company is never asked which; an admin always is, since
  // "no company" means a system only admins can use.
  const choosesOwner = isAdmin || owners.length > 1;
  const defaultOwner = isAdmin ? '' : (owners[0]?.id ?? '');
  const [systems, setSystems] = useState<PointSystem[]>(initialSystems);
  // The company's own charts first -- the ones it can change -- then the
  // GaitDesk standard ones it can choose or start one of its own from.
  const ordered = [...systems].sort(
    (a, b) => Number(a.standard) - Number(b.standard) || a.name.localeCompare(b.name),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  const edit = (next: Draft | null) => {
    setDraft(next);
    setError(null);
  };
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Give the points system a name.');
      return;
    }
    const chart = awardsFromChart(draft.chart);
    if ('error' in chart) {
      setError(chart.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(draft.id ? `/api/point-systems/${draft.id}` : '/api/point-systems', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          company_id: draft.companyId || null,
          association_id: draft.associationId || null,
          notes: draft.notes.trim() || null,
          awards: chart.awards,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'The points system could not be saved.'));
        return;
      }
      const saved = body as PointSystem;
      setSystems((list) =>
        [...list.filter((s) => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
      );
      edit(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (system: PointSystem) => {
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/point-systems/${system.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDeleteError({ id: system.id, message: errorMessage(body, 'The points system could not be deleted.') });
        return;
      }
      setSystems((list) => list.filter((s) => s.id !== system.id));
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {!draft && (
        <button
          type="button"
          onClick={() =>
            edit({ id: null, name: '', companyId: defaultOwner, associationId: '', notes: '', chart: blankChart() })
          }
          className="px-4 py-2 rounded text-sm font-medium"
          style={primaryButton}
        >
          + Add a points system
        </button>
      )}

      {draft && (
        <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            {draft.id ? `Edit ${draft.name || 'points system'}` : 'New points system'}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Name</span>
              <input
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="e.g. APHA open show points"
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
                maxLength={200}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Whose rules</span>
              <select
                value={draft.associationId}
                onChange={(e) => update({ associationId: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              >
                <option value="">None — a show or club&apos;s own scale</option>
                {associations.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </label>
          </div>

          {choosesOwner && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Show company</span>
              <select
                value={draft.companyId}
                onChange={(e) => update({ companyId: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              >
                {isAdmin && <option value="">None — GaitDesk standard, every company can use it</option>}
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.personal ? ' (independent)' : ''}</option>
                ))}
              </select>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Only people in this company see the system and can choose it for a show or circuit.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
              rows={2}
              maxLength={2000}
              placeholder="Where the chart comes from — printed under every leaderboard that uses it."
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
          </label>

          <ChartGridEditor chart={draft.chart} onChange={(chart) => update({ chart })} />

          {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
              {busy ? 'Saving…' : 'Save points system'}
            </button>
            <button type="button" onClick={() => edit(null)} disabled={busy} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {systems.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {isAdmin
            ? 'No show company has a points system yet.'
            : 'Your show company has no points systems yet. Add each association’s chart from its rule book, and your shows and circuits can then choose one.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {ordered.map((system) => {
            const editable = isAdmin || !system.standard;
            return (
            <li key={system.id} className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {system.name}
                    {(system.standard || choosesOwner) && (
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-hover)' }}>
                        {system.standard ? 'GaitDesk standard' : system.company_name}
                      </span>
                    )}
                    {system.association_code && (
                      <span className="ml-2 text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
                        {system.association_code}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    Used by {system.show_count} {system.show_count === 1 ? 'show' : 'shows'} and{' '}
                    {system.circuit_count} {system.circuit_count === 1 ? 'circuit' : 'circuits'}
                  </div>
                  {system.notes && <p className="text-sm mt-1" style={labelStyle}>{system.notes}</p>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {/* A starting point for a company that scores a little
                      differently: the chart opens as a new system under the
                      company, keeping the template's name -- the template
                      itself is badged, so the two cannot be confused. A show
                      that only wants its own copy takes it on the show's High
                      Point page instead. */}
                  <button
                    type="button"
                    onClick={() => edit({ ...draftFrom(system), id: null, companyId: defaultOwner })}
                    disabled={busy || Boolean(draft)}
                    title="Start a points system for your company from this chart"
                    className="hover:underline disabled:opacity-40"
                    style={{ color: 'var(--accent)' }}
                  >
                    Use this template
                  </button>
                  {editable && (
                  <button type="button" onClick={() => edit(draftFrom(system))} disabled={busy || Boolean(draft)} className="hover:underline disabled:opacity-40" style={{ color: 'var(--accent)' }}>
                    Edit
                  </button>
                  )}
                  {!editable ? null : confirmDelete === system.id ? (
                    <>
                      <button type="button" onClick={() => remove(system)} disabled={busy} className="font-medium hover:underline" style={{ color: 'var(--error)' }}>
                        Confirm delete
                      </button>
                      <button type="button" onClick={() => { setConfirmDelete(null); setDeleteError(null); }} className="hover:underline" style={{ color: 'var(--muted)' }}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(system.id)} disabled={busy} className="hover:underline disabled:opacity-40" style={{ color: 'var(--error)' }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {deleteError?.id === system.id && (
                <p className="text-sm" style={{ color: 'var(--error)' }}>{deleteError.message}</p>
              )}
              <ChartPreview awards={system.awards} />
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
