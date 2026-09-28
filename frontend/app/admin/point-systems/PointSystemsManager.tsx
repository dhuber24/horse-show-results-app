'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import {
  bandLabel,
  chartBands,
  formatPoints,
  ordinal,
  type PointAward,
  type PointSystem,
  type PointSystemOwner,
} from '@/lib/high-point';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;
const quietButton = { borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' } as const;

export type AssociationOption = { id: string; code: string; name: string };

type Band = { minEntries: string; points: string[] };
type Draft = {
  id: string | null;
  name: string;
  /** '' is no company: a system only GaitDesk admins can use. */
  companyId: string;
  associationId: string;
  notes: string;
  places: number;
  bands: Band[];
};

// A new chart starts with the one row every chart has: a class of one horse,
// which can only place first. "+ Class-size row" builds it out from there.
const BLANK: Draft = {
  id: null,
  name: '',
  companyId: '',
  associationId: '',
  notes: '',
  places: 1,
  bands: [{ minEntries: '1', points: [''] }],
};

// Wider than any printed chart; keeps the grid on a screen.
const MAX_PLACES = 30;

function wholeNumber(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : null;
}

/** The last class size a row covers: one below where the next row starts. A
 *  row stores only its first size, so this is how "3–4" is kept -- the 4 is the
 *  next row's 5, less one. Null for the last row, which covers every bigger
 *  class, and while the next row's start is not a number yet. */
function rowTop(bands: Band[], index: number): number | null {
  const next = bands[index + 1];
  if (!next) return null;
  const nextFrom = wholeNumber(next.minEntries);
  return nextFrom === null ? null : nextFrom - 1;
}

/** How many places a row may award: as many as the largest class in its
 *  range, so a 5–9 row pays down to 9th (migration 152). The last row is
 *  open-ended and has only its first size to go by, so "45 & over" pays at most
 *  45. 0 while the range is not whole numbers in order -- nothing can be typed
 *  until it is. */
function placeLimit(bands: Band[], index: number): number {
  const from = wholeNumber(bands[index].minEntries);
  if (from === null) return 0;
  if (index === bands.length - 1) return from;
  const top = rowTop(bands, index);
  return top !== null && top >= from ? top : 0;
}

/** "3–4", "2", or "45 or more". */
function rangeText(bands: Band[], index: number): string {
  const from = bands[index].minEntries || '?';
  if (index === bands.length - 1) return `${from} or more`;
  const top = rowTop(bands, index);
  return top === null ? `${from}–?` : String(top) === from ? from : `${from}–${top}`;
}

function widestRow(bands: Band[]): number {
  return Math.min(MAX_PLACES, Math.max(0, ...bands.map((_, i) => placeLimit(bands, i))));
}

function draftFrom(system: PointSystem): Draft {
  const bands = chartBands(system.awards);
  const places = Math.max(1, ...bands.map((b) => b.points.length));
  return {
    id: system.id,
    name: system.name,
    companyId: system.company_id ?? '',
    associationId: system.association_id ?? '',
    notes: system.notes ?? '',
    places,
    bands: bands.map((b) => ({
      minEntries: String(b.minEntries),
      points: Array.from({ length: places }, (_, i) => (b.points[i] ? String(b.points[i]) : '')),
    })),
  };
}

/** The grid as award rows, or the reason it cannot be saved. */
function awardsFrom(draft: Draft): { awards: PointAward[] } | { error: string } {
  const awards: PointAward[] = [];
  const { bands } = draft;
  for (let b = 0; b < bands.length; b++) {
    const minEntries = wholeNumber(bands[b].minEntries);
    if (minEntries === null) {
      return { error: 'Every row needs a class size that is a whole number of horses, 1 or more.' };
    }
    const previous = b > 0 ? wholeNumber(bands[b - 1].minEntries) : null;
    if (previous !== null && minEntries <= previous) {
      return { error: `Rows must run from the smallest classes to the largest: row ${b + 1} starts at ${minEntries}, which is not after row ${b}.` };
    }
    const range = rangeText(bands, b);
    // Only the cells on screen: a place past the row's range is shown blank and
    // greyed out, so it is not what anybody is saving.
    const limit = placeLimit(bands, b);
    let paid = 0;
    for (let i = 0; i < Math.min(draft.places, limit); i++) {
      const raw = (bands[b].points[i] ?? '').trim();
      if (!raw) continue;
      const points = Number(raw);
      if (!Number.isFinite(points) || points < 0) {
        return { error: `${ordinal(i + 1)} place in classes of ${range} is not a number of points.` };
      }
      if (points > 0) {
        awards.push({ min_entries: minEntries, place: i + 1, points });
        paid += 1;
      }
    }
    // A row with nothing in it is not saved, and the row above would then
    // stretch over its range -- so a class that was meant to earn nothing
    // would quietly earn the row above's points.
    if (paid === 0) {
      return { error: `Classes of ${range} have no points. Give their row some, or remove it.` };
    }
  }
  if (awards.length === 0) return { error: 'Enter the points for at least one place.' };
  return { awards };
}

function ChartPreview({ system }: { system: PointSystem }) {
  const bands = chartBands(system.awards);
  const places = Math.max(0, ...bands.map((b) => b.points.length));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr style={{ color: 'var(--accent)' }}>
            <th className="text-left font-semibold py-1 pr-4">Class size</th>
            {Array.from({ length: places }, (_, i) => (
              <th key={i} className="text-right font-semibold py-1 px-2">{ordinal(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((band, index) => (
            <tr key={band.minEntries} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="py-1 pr-4 whitespace-nowrap" style={labelStyle}>{bandLabel(bands, index)}</td>
              {Array.from({ length: places }, (_, i) => (
                <td key={i} className="py-1 px-2 text-right" style={labelStyle}>
                  {band.points[i] ? formatPoints(band.points[i]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  const setCell = (bandIndex: number, place: number, value: string) =>
    setDraft((d) => {
      if (!d) return d;
      const bands = d.bands.map((b, i) =>
        i === bandIndex ? { ...b, points: b.points.map((p, j) => (j === place ? value : p)) } : b,
      );
      return { ...d, bands };
    });
  // The most places any row may award -- no column past it could ever be filled.
  const widest = draft ? widestRow(draft.bands) : 0;
  // Neither edit clears a cell. A cell past a row's range is greyed out and not
  // saved, but it keeps what was typed: typing "14" goes through "1" on the way,
  // and that must not wipe the row it briefly narrowed.
  const setFrom = (bandIndex: number, value: string) =>
    setDraft((d) =>
      d ? { ...d, bands: d.bands.map((b, i) => (i === bandIndex ? { ...b, minEntries: value } : b)) } : d,
    );
  // Where a row ends is where the next one starts, less one -- so typing the
  // end of 3–4 starts the next row at 5.
  const setTo = (bandIndex: number, value: string) =>
    setDraft((d) => {
      if (!d || bandIndex + 1 >= d.bands.length) return d;
      const top = Number(value);
      const nextFrom = value.trim() === '' || !Number.isFinite(top) ? '' : String(Math.trunc(top) + 1);
      return {
        ...d,
        bands: d.bands.map((b, i) => (i === bandIndex + 1 ? { ...b, minEntries: nextFrom } : b)),
      };
    });
  const setPlaces = (places: number) =>
    setDraft((d) => {
      if (!d || places < 1 || places > widestRow(d.bands)) return d;
      return {
        ...d,
        places,
        bands: d.bands.map((b) => ({
          ...b,
          points: Array.from({ length: places }, (_, i) => b.points[i] ?? ''),
        })),
      };
    });
  // The next class size up, and one more place column -- a printed chart
  // usually pays one more place per range, so building one row by row keeps
  // the grid as wide as it needs and no wider.
  const addBand = () =>
    setDraft((d) => {
      if (!d) return d;
      const highest = Math.max(0, ...d.bands.map((b) => Number(b.minEntries) || 0));
      const minEntries = highest + 1;
      const places = Math.min(MAX_PLACES, Math.max(d.places, Math.min(d.places + 1, minEntries)));
      const widen = (points: string[]) => Array.from({ length: places }, (_, i) => points[i] ?? '');
      return {
        ...d,
        places,
        bands: [
          ...d.bands.map((b) => ({ ...b, points: widen(b.points) })),
          { minEntries: String(minEntries), points: widen([]) },
        ],
      };
    });
  const removeBand = (index: number) =>
    setDraft((d) => (d && d.bands.length > 1 ? { ...d, bands: d.bands.filter((_, i) => i !== index) } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Give the points system a name.');
      return;
    }
    const chart = awardsFrom(draft);
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
            edit({ ...BLANK, companyId: defaultOwner, bands: BLANK.bands.map((b) => ({ ...b, points: [...b.points] })) })
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

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Points by place</div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              One row per range of class sizes, the way the rules print them &mdash; 3&ndash;4, 5&ndash;9,
              10&ndash;14. Typing where a row ends starts the next row one higher. A row pays as many
              places as the largest class in its range, so a 5&ndash;9 row can pay down to 9th; the last
              row covers every bigger class and pays as many places as its first size. A class
              smaller than the first row earns nothing. A flat 6-5-4-3-2-1 scale is two rows,
              1&ndash;6 and 7 &amp; over. Leave a place blank for no points.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead>
                  <tr style={{ color: 'var(--accent)' }}>
                    <th className="text-left text-xs font-semibold py-1 pr-2 whitespace-nowrap">Class size</th>
                    {Array.from({ length: draft.places }, (_, i) => (
                      <th key={i} className="text-xs font-semibold py-1 px-1 text-center">{ordinal(i + 1)}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.bands.map((band, bandIndex) => (
                    <tr key={bandIndex}>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={band.minEntries}
                            onChange={(e) => setFrom(bandIndex, e.target.value)}
                            aria-label={`Row ${bandIndex + 1}: smallest class size`}
                            className="border rounded px-2 py-1 w-16 text-sm"
                            style={inputStyle}
                          />
                          <span aria-hidden="true" style={{ color: 'var(--muted)' }}>&ndash;</span>
                          {bandIndex === draft.bands.length - 1 ? (
                            <span className="text-xs px-1" style={{ color: 'var(--muted)' }} title="The last row covers every bigger class">
                              &amp; over
                            </span>
                          ) : (
                            <input
                              type="number"
                              min={1}
                              inputMode="numeric"
                              value={rowTop(draft.bands, bandIndex) ?? ''}
                              onChange={(e) => setTo(bandIndex, e.target.value)}
                              aria-label={`Row ${bandIndex + 1}: largest class size`}
                              title="Where this row ends. The next row starts one higher."
                              className="border rounded px-2 py-1 w-16 text-sm"
                              style={inputStyle}
                            />
                          )}
                        </div>
                      </td>
                      {Array.from({ length: draft.places }, (_, place) => {
                        const limit = placeLimit(draft.bands, bandIndex);
                        const beyond = place + 1 > limit;
                        return (
                          <td key={place} className="py-1 px-1">
                            <input
                              inputMode="decimal"
                              value={beyond ? '' : (band.points[place] ?? '')}
                              onChange={(e) => setCell(bandIndex, place, e.target.value)}
                              disabled={beyond}
                              placeholder={beyond ? '—' : undefined}
                              title={
                                beyond
                                  ? limit
                                    ? `Classes of ${rangeText(draft.bands, bandIndex)} can pay at most ${limit} ${limit === 1 ? 'place' : 'places'}`
                                    : 'Enter the class sizes, smallest row first'
                                  : undefined
                              }
                              aria-label={`${ordinal(place + 1)} place, classes of ${rangeText(draft.bands, bandIndex)}`}
                              className="border rounded px-1 py-1 w-14 text-sm text-center disabled:opacity-40"
                              style={beyond ? { ...inputStyle, backgroundColor: 'var(--bg-subtle)' } : inputStyle}
                            />
                          </td>
                        );
                      })}
                      <td className="py-1 pl-2">
                        <button
                          type="button"
                          onClick={() => removeBand(bandIndex)}
                          disabled={draft.bands.length === 1}
                          title={draft.bands.length === 1 ? 'A chart needs at least one row' : 'Remove this row'}
                          className="text-xs hover:underline disabled:opacity-40"
                          style={{ color: 'var(--error)' }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addBand} className="px-3 py-1.5 rounded border text-xs font-medium" style={quietButton}>
                + Class-size row
              </button>
              <button
                type="button"
                onClick={() => setPlaces(draft.places + 1)}
                disabled={draft.places >= widest}
                title={
                  draft.places >= widest
                    ? `No row can pay a ${ordinal(draft.places + 1)} place: the widest range tops out at ${widest}. Widen a row's range, or add a row, first`
                    : 'Add a place column'
                }
                className="px-3 py-1.5 rounded border text-xs font-medium disabled:opacity-40"
                style={quietButton}
              >
                + Place
              </button>
              <button
                type="button"
                onClick={() => setPlaces(draft.places - 1)}
                disabled={draft.places <= 1}
                title={draft.places <= 1 ? 'A chart needs at least one place' : 'Remove the last place column'}
                className="px-3 py-1.5 rounded border text-xs font-medium disabled:opacity-40"
                style={quietButton}
              >
                − Place
              </button>
            </div>
          </div>

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
                      itself is badged, so the two cannot be confused. */}
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
              <ChartPreview system={system} />
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
