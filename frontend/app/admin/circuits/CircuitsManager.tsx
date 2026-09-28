'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { Circuit } from '@/lib/high-point';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;

export type ShowOption = { id: string; name: string; start_date: string; status: string };
export type SystemOption = { id: string; name: string };

type Form = { name: string; season: string; pointSystemId: string; notes: string };

function formFrom(circuit?: Circuit): Form {
  return {
    name: circuit?.name ?? '',
    season: circuit?.season ?? String(new Date().getFullYear()),
    pointSystemId: circuit?.point_system?.id ?? '',
    notes: circuit?.notes ?? '',
  };
}

function CircuitFields({ form, onChange, systems, idPrefix, current }: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  systems: SystemOption[];
  idPrefix: string;
  /** The circuit's system as saved. Kept on offer by name when it is not one of
   *  the caller's own company's (migration 148). */
  current?: SystemOption | null;
}) {
  const foreign = current && !systems.some((s) => s.id === current.id) ? current : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-name`}>
        <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Name</span>
        <input id={`${idPrefix}-name`} value={form.name} onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. MNSPHC Season Circuit" maxLength={200}
          className="border rounded px-3 py-2 text-sm" style={inputStyle} />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-season`}>
        <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Season</span>
        <input id={`${idPrefix}-season`} value={form.season} onChange={(e) => onChange({ season: e.target.value })}
          placeholder="2026" maxLength={50}
          className="border rounded px-3 py-2 text-sm" style={inputStyle} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2" htmlFor={`${idPrefix}-system`}>
        <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Points system</span>
        <select id={`${idPrefix}-system`} value={form.pointSystemId} onChange={(e) => onChange({ pointSystemId: e.target.value })}
          className="border rounded px-3 py-2 text-sm" style={inputStyle}>
          <option value="">Not chosen yet — no standings until one is</option>
          {foreign && <option value={foreign.id}>{foreign.name} (another company&apos;s)</option>}
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2" htmlFor={`${idPrefix}-notes`}>
        <span className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Notes</span>
        <textarea id={`${idPrefix}-notes`} value={form.notes} onChange={(e) => onChange({ notes: e.target.value })}
          rows={2} maxLength={2000} placeholder="Printed on the circuit's public standings page."
          className="border rounded px-3 py-2 text-sm" style={inputStyle} />
      </label>
    </div>
  );
}

/**
 * Season circuits (migration 147): several shows whose posted placings add up
 * under the circuit's own points system. Whoever creates a circuit manages it,
 * and adds shows they work; a show's own office may take its show out.
 */
export default function CircuitsManager({
  initialCircuits,
  myShows,
  systems,
  userId,
  isAdmin,
}: {
  initialCircuits: Circuit[];
  myShows: ShowOption[];
  systems: SystemOption[];
  userId: string;
  isAdmin: boolean;
}) {
  const [circuits, setCircuits] = useState<Circuit[]>(initialCircuits);
  const [creating, setCreating] = useState<Form | null>(null);
  const [editing, setEditing] = useState<{ id: string; form: Form } | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);

  const myShowIds = new Set(myShows.map((s) => s.id));
  const canEdit = (c: Circuit) => isAdmin || c.created_by_user_id === userId;

  const replace = (saved: Circuit) =>
    setCircuits((list) => (list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...list]));

  /** Runs one request; returns the parsed body, or null after showing why it failed. */
  const run = async (scope: string, url: string, init: RequestInit, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const body = res.status === 204 ? {} : await res.json().catch(() => null);
      if (!res.ok) {
        setError({ scope, message: errorMessage(body, fallback) });
        return null;
      }
      return body;
    } finally {
      setBusy(false);
    }
  };

  const payload = (form: Form) => ({
    name: form.name.trim(),
    season: form.season.trim() || null,
    point_system_id: form.pointSystemId || null,
    notes: form.notes.trim() || null,
  });

  const create = async () => {
    if (!creating) return;
    if (!creating.name.trim()) return setError({ scope: 'new', message: 'Give the circuit a name.' });
    const body = await run('new', '/api/circuits', { method: 'POST', body: JSON.stringify(payload(creating)) }, 'The circuit could not be created.');
    if (body) {
      replace(body as Circuit);
      setCreating(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.form.name.trim()) return setError({ scope: editing.id, message: 'Give the circuit a name.' });
    const body = await run(editing.id, `/api/circuits/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload(editing.form)) }, 'The circuit could not be saved.');
    if (body) {
      replace(body as Circuit);
      setEditing(null);
    }
  };

  const remove = async (circuit: Circuit) => {
    const body = await run(circuit.id, `/api/circuits/${circuit.id}`, { method: 'DELETE' }, 'The circuit could not be deleted.');
    if (body) {
      setCircuits((list) => list.filter((c) => c.id !== circuit.id));
      setConfirmDelete(null);
    }
  };

  const addShow = async (circuit: Circuit) => {
    const showId = adding[circuit.id];
    if (!showId) return;
    const body = await run(circuit.id, `/api/circuits/${circuit.id}/shows/${showId}`, { method: 'PUT' }, 'The show could not be added.');
    if (body) {
      replace(body as Circuit);
      setAdding((a) => ({ ...a, [circuit.id]: '' }));
    }
  };

  const removeShow = async (circuit: Circuit, showId: string) => {
    const body = await run(circuit.id, `/api/circuits/${circuit.id}/shows/${showId}`, { method: 'DELETE' }, 'The show could not be removed.');
    if (body) replace(body as Circuit);
  };

  return (
    <div className="space-y-6">
      {creating ? (
        <section className="border rounded-lg p-4 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>New circuit</h2>
          <CircuitFields form={creating} onChange={(p) => setCreating((f) => (f ? { ...f, ...p } : f))} systems={systems} idPrefix="new-circuit" />
          {error?.scope === 'new' && <p className="text-sm" style={{ color: 'var(--error)' }}>{error.message}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={create} disabled={busy} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
              {busy ? 'Saving…' : 'Create circuit'}
            </button>
            <button type="button" onClick={() => { setCreating(null); setError(null); }} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => setCreating(formFrom())} className="px-4 py-2 rounded text-sm font-medium" style={primaryButton}>
          + New circuit
        </button>
      )}

      {systems.length === 0 && (
        <p className="text-sm rounded border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
          Your show company has no points systems yet. A circuit can be set up now, and its
          standings appear once it has one — add your association&apos;s chart under{' '}
          <Link href="/admin/point-systems" className="underline" style={{ color: 'var(--accent)' }}>Points Systems</Link>.
        </p>
      )}

      {circuits.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No circuits yet.</p>
      ) : (
        <ul className="space-y-4">
          {circuits.map((circuit) => {
            const editable = canEdit(circuit);
            const inCircuit = new Set(circuit.shows.map((s) => s.id));
            const addable = myShows.filter((s) => !inCircuit.has(s.id));
            return (
              <li key={circuit.id} className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                {editing?.id === circuit.id ? (
                  <div className="space-y-3">
                    <CircuitFields form={editing.form} onChange={(p) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...p } } : e))} systems={systems} idPrefix={`circuit-${circuit.id}`} current={circuit.point_system} />
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={saveEdit} disabled={busy} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => { setEditing(null); setError(null); }} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {circuit.name}{circuit.season ? ` · ${circuit.season}` : ''}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {circuit.point_system ? circuit.point_system.name : 'No points system chosen'}
                        {!editable && ' · managed by another account'}
                      </div>
                      {circuit.notes && <p className="text-sm mt-1" style={labelStyle}>{circuit.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3 text-sm flex-wrap">
                      <Link href={`/circuits/${circuit.id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                        Standings →
                      </Link>
                      {editable && (
                        <>
                          <button type="button" onClick={() => { setEditing({ id: circuit.id, form: formFrom(circuit) }); setError(null); }} className="hover:underline" style={{ color: 'var(--accent)' }}>
                            Edit
                          </button>
                          {confirmDelete === circuit.id ? (
                            <>
                              <button type="button" onClick={() => remove(circuit)} disabled={busy} className="font-medium hover:underline" style={{ color: 'var(--error)' }}>
                                Confirm delete
                              </button>
                              <button type="button" onClick={() => setConfirmDelete(null)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                                Keep
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setConfirmDelete(circuit.id)} className="hover:underline" style={{ color: 'var(--error)' }}>
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {confirmDelete === circuit.id && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Deleting the circuit removes its season standings. The shows and their results are not touched.
                  </p>
                )}

                <div>
                  <div className="text-xs font-medium uppercase tracking-wide mb-1" style={labelStyle}>
                    Shows ({circuit.shows.length})
                  </div>
                  {circuit.shows.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>No shows added yet.</p>
                  ) : (
                    <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                      {circuit.shows.map((show) => (
                        <li key={show.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                          <span style={{ color: 'var(--foreground)' }}>
                            {show.name}
                            <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>{show.start_date}</span>
                          </span>
                          {(editable || myShowIds.has(show.id)) && (
                            <button type="button" onClick={() => removeShow(circuit, show.id)} disabled={busy} className="text-xs hover:underline disabled:opacity-40" style={{ color: 'var(--error)' }}>
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {editable && (
                  addable.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      Every show you work is already in this circuit. A show is added by somebody who works it.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={adding[circuit.id] ?? ''}
                        onChange={(e) => setAdding((a) => ({ ...a, [circuit.id]: e.target.value }))}
                        aria-label={`Add a show to ${circuit.name}`}
                        className="border rounded px-3 py-1.5 text-sm min-w-0 max-w-full"
                        style={inputStyle}
                      >
                        <option value="">Add one of your shows…</option>
                        {addable.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.start_date})</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addShow(circuit)}
                        disabled={busy || !adding[circuit.id]}
                        title={!adding[circuit.id] ? 'Pick a show first' : undefined}
                        className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                        style={primaryButton}
                      >
                        Add show
                      </button>
                    </div>
                  )
                )}

                {error?.scope === circuit.id && <p className="text-sm" style={{ color: 'var(--error)' }}>{error.message}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
