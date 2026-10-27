'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import {
  fieldsFor,
  filledCounts,
  selectionToSave,
  startingSelection,
  toDataCsv,
  type DataExport,
  type DataExportKind,
  type SavedSelection,
} from '@/lib/data-export';

const STORAGE_KEY = 'gaitdesk.data-export.columns.v1';
const PREVIEW_ROWS = 10;

const KINDS: { kind: DataExportKind; label: string; hint: string }[] = [
  {
    kind: 'placings',
    label: 'One row per placing',
    hint: 'Every posted placing, one row per judge’s card.',
  },
  {
    kind: 'entries',
    label: 'One row per entry',
    hint: 'Every class entry, posted or not, with scratches marked.',
  },
];

/** The office's last choice of columns, per row kind. A convenience only: a
 *  private window or blocked storage starts from the defaults. */
function loadSaved(): Partial<Record<DataExportKind, SavedSelection>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function storeSaved(value: Partial<Record<DataExportKind, SavedSelection>>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Not remembered next time; nothing else depends on it.
  }
}

export default function DataExportBuilder({ showId, showName }: { showId: string; showName: string }) {
  const [data, setData] = useState<DataExport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<DataExportKind>('placings');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shows/${showId}/data-export`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(errorMessage(body, 'Couldn’t load the show’s data.'));
          return;
        }
        setData(body as DataExport);
      } catch {
        if (!cancelled) setLoadError('Couldn’t reach GaitDesk. Check your connection and reload.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showId]);

  const fields = useMemo(() => (data ? fieldsFor(data, kind) : []), [data, kind]);
  const rows = useMemo(() => (data ? data[kind] : []), [data, kind]);
  const filled = useMemo(() => filledCounts(fields, rows), [fields, rows]);

  // A row kind's columns start from what the office picked last time.
  useEffect(() => {
    if (!data) return;
    setSelected(startingSelection(fields, loadSaved()[kind] ?? null));
  }, [data, kind, fields]);

  const choose = (next: Set<string>) => {
    setSelected(next);
    const saved = loadSaved();
    storeSaved({ ...saved, [kind]: selectionToSave(fields, next, saved[kind] ?? null) });
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    choose(next);
  };

  const setGroup = (group: string, on: boolean) => {
    const next = new Set(selected);
    for (const f of fields) {
      if (f.group !== group) continue;
      if (on) next.add(f.key);
      else next.delete(f.key);
    }
    choose(next);
  };

  const columns = fields.filter((f) => selected.has(f.key));

  const download = () => {
    // The byte-order mark is what makes a spreadsheet read the file as UTF-8,
    // so an accented name or a show called "Paint-O-Rama — Day 2" survives.
    const blob = new Blob(['﻿' + toDataCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeShow = showName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    link.href = url;
    link.download = `${safeShow || 'show'}-${kind}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loadError) {
    return (
      <div
        className="rounded border p-4 text-sm"
        style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
      >
        {loadError}
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Loading the show&rsquo;s data&hellip;
      </p>
    );
  }

  const downloadBlocked = columns.length === 0
    ? 'Pick at least one column'
    : rows.length === 0
      ? kind === 'placings'
        ? 'No classes are posted yet'
        : 'Nobody has entered yet'
      : null;

  return (
    <div className="space-y-6">
      <section
        className="rounded-lg border p-4 space-y-3"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Rows</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {KINDS.map((option) => (
            <label
              key={option.kind}
              className="flex items-start gap-2 rounded border p-3 cursor-pointer"
              style={{
                borderColor: kind === option.kind ? 'var(--accent)' : 'var(--border)',
                backgroundColor: kind === option.kind ? 'var(--background)' : 'var(--surface)',
              }}
            >
              <input
                type="radio"
                name="data-export-kind"
                className="mt-1"
                checked={kind === option.kind}
                onChange={() => setKind(option.kind)}
              />
              <span>
                <span className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {option.label}{' '}
                  <span className="font-normal" style={{ color: 'var(--muted)' }}>
                    ({data[option.kind].length.toLocaleString('en-US')})
                  </span>
                </span>
                <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section
        className="rounded-lg border p-4 space-y-4"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            Columns{' '}
            <span className="font-normal text-sm" style={{ color: 'var(--muted)' }}>
              {columns.length} of {fields.length} picked
            </span>
          </h2>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => choose(new Set(fields.filter((f) => f.default).map((f) => f.key)))}
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              Suggested
            </button>
            <button
              type="button"
              onClick={() => choose(new Set(fields.map((f) => f.key)))}
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => choose(new Set())}
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              None
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 desktop:grid-cols-3 gap-4">
          {data.groups.map((group) => {
            const inGroup = fields.filter((f) => f.group === group.key);
            if (inGroup.length === 0) return null;
            return (
              <fieldset key={group.key} className="space-y-1.5">
                <legend className="flex w-full items-center justify-between gap-2 text-sm font-semibold mb-1" style={{ color: 'var(--text-deep)' }}>
                  <span>{group.label}</span>
                  <span className="flex gap-2 text-xs font-normal">
                    <button type="button" onClick={() => setGroup(group.key, true)} className="underline" style={{ color: 'var(--accent)' }}>
                      All
                    </button>
                    <button type="button" onClick={() => setGroup(group.key, false)} className="underline" style={{ color: 'var(--accent)' }}>
                      None
                    </button>
                  </span>
                </legend>
                {inGroup.map((f) => (
                  <label key={f.key} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(f.key)}
                      onChange={() => toggle(f.key)}
                    />
                    <span style={{ color: 'var(--foreground)' }}>
                      {f.label}
                      {rows.length > 0 && filled[f.key] === 0 && (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}> · none on file</span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            Preview{' '}
            <span className="font-normal text-sm" style={{ color: 'var(--muted)' }}>
              {rows.length > PREVIEW_ROWS
                ? `first ${PREVIEW_ROWS} of ${rows.length.toLocaleString('en-US')} rows`
                : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </span>
          </h2>
          <button
            type="button"
            onClick={download}
            disabled={downloadBlocked !== null}
            title={downloadBlocked ?? `Download ${rows.length.toLocaleString('en-US')} rows as CSV`}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            ⬇ Download CSV
          </button>
        </div>

        {columns.length === 0 || rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {downloadBlocked}
            </p>
          </div>
        ) : (
          // Wide files scroll inside their own box rather than pushing the page
          // sideways, the way the reports do.
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm" style={{ backgroundColor: 'var(--surface)' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--background)' }}>
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2 font-semibold text-left whitespace-nowrap" style={{ color: 'var(--text-deep)' }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--bg-subtle)' }}>
                {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  <tr key={index}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-deep)' }}>
                        {row[c.key] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.notes.length > 0 && (
          <ul className="text-xs space-y-1 list-disc pl-5" style={{ color: 'var(--muted)' }}>
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
