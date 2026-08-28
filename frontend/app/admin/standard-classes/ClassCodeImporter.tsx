'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type CatalogSummary = {
  show_type_id: string;
  show_type_code: string;
  show_type_name?: string;
  active_count: number;
  divisions: string[];
  pdf_supported: boolean;
  last_import: ImportRecord | null;
};

type ImportRecord = {
  id: string;
  filename: string;
  source_year: number | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
  added_count: number;
  changed_count: number;
  retired_count: number;
  unchanged_count: number;
};

type Row = {
  code: string;
  name: string;
  division: string;
  sort_order: number;
  notes: string | null;
};

type Change = { code: string; before: Row; after: Row; fields: string[] };

type Preview = {
  show_type_id: string;
  show_type_code: string;
  filename: string;
  parsed_count: number;
  unchanged_count: number;
  added: Row[];
  changed: Change[];
  retired: Row[];
  warnings: string[];
  skipped: string[];
};

type Result = {
  added_count: number;
  changed_count: number;
  retired_count: number;
  unchanged_count: number;
  active_count: number;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
  link: '#8b4513',
  added: '#2f6b3f',
  retired: '#9b2c2c',
} as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function ClassCodeImporter({ catalogs }: { catalogs: CatalogSummary[] }) {
  const router = useRouter();
  const [showTypeId, setShowTypeId] = useState(catalogs[0]?.show_type_id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [sourceYear, setSourceYear] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [retire, setRetire] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = catalogs.find((c) => c.show_type_id === showTypeId) ?? catalogs[0];

  function reset() {
    setPreview(null);
    setRetire(new Set());
    setResult(null);
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/admin/standard-classes/${showTypeId}/preview`, {
        method: 'POST',
        body,
      });
      const json = await res.json();
      if (!res.ok) {
        setPreview(null);
        setError(json?.detail || json?.error || 'Could not read that file.');
        return;
      }
      setPreview(json);
      setRetire(new Set());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('retire_codes', Array.from(retire).join(','));
      if (sourceYear.trim()) body.append('source_year', sourceYear.trim());
      const res = await fetch(`/api/admin/standard-classes/${showTypeId}/apply`, {
        method: 'POST',
        body,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail || json?.error || 'The import could not be applied.');
        return;
      }
      setResult(json);
      setPreview(null);
      setRetire(new Set());
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const nothingToDo =
    preview !== null &&
    preview.added.length === 0 &&
    preview.changed.length === 0 &&
    retire.size === 0;

  return (
    <div className="space-y-6">
      {/* ── Pick the association ─────────────────────────────────────────── */}
      <section
        className="rounded border p-4 space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
      >
        <div>
          <label
            htmlFor="association"
            className="block text-sm font-medium mb-1"
            style={{ color: COLORS.text }}
          >
            Association
          </label>
          <select
            id="association"
            value={showTypeId}
            onChange={(e) => {
              setShowTypeId(e.target.value);
              setFile(null);
              reset();
            }}
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: COLORS.border, color: COLORS.text }}
          >
            {catalogs.map((c) => (
              <option key={c.show_type_id} value={c.show_type_id}>
                {c.show_type_code}
                {c.show_type_name && c.show_type_name !== c.show_type_code
                  ? ` — ${c.show_type_name}`
                  : ''}
              </option>
            ))}
          </select>
        </div>

        {catalog && (
          <div className="text-sm" style={{ color: COLORS.muted }}>
            <p>
              <strong style={{ color: COLORS.text }}>
                {catalog.active_count.toLocaleString()}
              </strong>{' '}
              approved {catalog.active_count === 1 ? 'code' : 'codes'} on file
              {catalog.divisions.length > 0 &&
                ` across ${catalog.divisions.length} ${
                  catalog.divisions.length === 1 ? 'division' : 'divisions'
                }`}
              .
            </p>
            {catalog.last_import ? (
              <p className="mt-1">
                Last loaded {formatDate(catalog.last_import.uploaded_at)} from{' '}
                {catalog.last_import.filename}
                {catalog.last_import.uploaded_by_name
                  ? ` by ${catalog.last_import.uploaded_by_name}`
                  : ''}
                .
              </p>
            ) : (
              <p className="mt-1">No upload recorded yet.</p>
            )}
          </div>
        )}
      </section>

      {/* ── Upload ───────────────────────────────────────────────────────── */}
      <section
        className="rounded border p-4 space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
      >
        <div>
          <label
            htmlFor="classfile"
            className="block text-sm font-medium mb-1"
            style={{ color: COLORS.text }}
          >
            Class list file
          </label>
          <input
            id="classfile"
            type="file"
            accept=".pdf,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              reset();
            }}
            className="text-sm"
            style={{ color: COLORS.text }}
          />
          <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
            {catalog?.pdf_supported
              ? `The ${catalog.show_type_code} PDF can be read directly. A CSV with code, name, and division columns also works.`
              : `Upload a CSV with code, name, and division columns. The app has not been taught ${catalog?.show_type_code}'s PDF layout.`}
          </p>
        </div>

        <div>
          <label
            htmlFor="sourceyear"
            className="block text-sm font-medium mb-1"
            style={{ color: COLORS.text }}
          >
            Source year <span style={{ color: COLORS.muted }}>(optional)</span>
          </label>
          <input
            id="sourceyear"
            type="text"
            inputMode="numeric"
            value={sourceYear}
            onChange={(e) => setSourceYear(e.target.value)}
            placeholder="2026"
            className="rounded border px-3 py-2 text-sm w-32"
            style={{ borderColor: COLORS.border, color: COLORS.text }}
          />
          <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
            Recorded against the rows this file adds or changes.
          </p>
        </div>

        <button
          type="button"
          onClick={runPreview}
          disabled={!file || busy}
          title={!file ? 'Choose a file first' : undefined}
          className="rounded px-4 py-2 text-sm font-medium border disabled:opacity-50"
          style={{
            borderColor: COLORS.link,
            backgroundColor: file && !busy ? COLORS.link : '#fff',
            color: file && !busy ? '#fff' : COLORS.muted,
          }}
        >
          {busy ? 'Reading…' : 'Compare with catalog'}
        </button>
      </section>

      {error && (
        <div
          className="rounded border p-3 text-sm"
          style={{ borderColor: '#e0b4b4', backgroundColor: '#fdf0f0', color: '#7a2c2c' }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="rounded border p-4 text-sm space-y-1"
          style={{ borderColor: COLORS.border, backgroundColor: '#f4faf5', color: COLORS.warn }}
        >
          <p className="font-medium" style={{ color: COLORS.added }}>
            Catalog updated.
          </p>
          <p>
            {result.added_count} added, {result.changed_count} changed,{' '}
            {result.retired_count} retired, {result.unchanged_count} unchanged.{' '}
            {result.active_count.toLocaleString()} codes are now approved.
          </p>
        </div>
      )}

      {preview && <PreviewPanel
        preview={preview}
        retire={retire}
        setRetire={setRetire}
        onApply={apply}
        busy={busy}
        nothingToDo={nothingToDo}
      />}
    </div>
  );
}

function PreviewPanel({
  preview,
  retire,
  setRetire,
  onApply,
  busy,
  nothingToDo,
}: {
  preview: Preview;
  retire: Set<string>;
  setRetire: (next: Set<string>) => void;
  onApply: () => void;
  busy: boolean;
  nothingToDo: boolean;
}) {
  function toggle(code: string) {
    const next = new Set(retire);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setRetire(next);
  }

  return (
    <section
      className="rounded border p-4 space-y-5"
      style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
    >
      <div>
        <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
          {preview.filename}
        </h2>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          {preview.parsed_count.toLocaleString()} codes read —{' '}
          <strong style={{ color: COLORS.added }}>{preview.added.length} new</strong>,{' '}
          <strong style={{ color: COLORS.warn }}>{preview.changed.length} changed</strong>,{' '}
          <strong style={{ color: COLORS.retired }}>
            {preview.retired.length} missing from this file
          </strong>
          , {preview.unchanged_count.toLocaleString()} unchanged.
        </p>
      </div>

      {preview.warnings.length > 0 && (
        <Notice title="Rows skipped while reading the file" items={preview.warnings} />
      )}
      {preview.skipped.length > 0 && (
        <Notice
          title="Lines the reader could not place"
          hint="Usually page furniture. A long list here means the association changed its layout."
          items={preview.skipped}
        />
      )}

      {preview.added.length > 0 && (
        <Group title={`New codes (${preview.added.length})`}>
          <table className="w-full text-sm">
            <tbody>
              {preview.added.map((row) => (
                <tr key={row.code} style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
                  <td className="py-1 pr-3 font-mono align-top" style={{ color: COLORS.added }}>
                    {row.code}
                  </td>
                  <td className="py-1 pr-3" style={{ color: COLORS.text }}>
                    {row.name}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap" style={{ color: COLORS.muted }}>
                    {row.division}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}

      {preview.changed.length > 0 && (
        <Group
          title={`Changed (${preview.changed.length})`}
          hint="The stored row is replaced with a new version. The old one stays readable in history."
        >
          <table className="w-full text-sm">
            <tbody>
              {preview.changed.map((change) => (
                <tr
                  key={change.code}
                  style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}
                >
                  <td className="py-2 pr-3 font-mono align-top" style={{ color: COLORS.warn }}>
                    {change.code}
                  </td>
                  <td className="py-2">
                    <div style={{ color: COLORS.muted }}>
                      <span className="line-through">{change.before.name}</span>
                      {change.before.division !== change.after.division && (
                        <span className="ml-2 text-xs">({change.before.division})</span>
                      )}
                    </div>
                    <div style={{ color: COLORS.text }}>
                      {change.after.name}
                      {change.before.division !== change.after.division && (
                        <span className="ml-2 text-xs" style={{ color: COLORS.muted }}>
                          ({change.after.division})
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="py-2 text-right align-top text-xs whitespace-nowrap"
                    style={{ color: COLORS.muted }}
                  >
                    {change.fields.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}

      {preview.retired.length > 0 && (
        <Group
          title={`In the catalog, not in this file (${preview.retired.length})`}
          hint="Nothing here is retired unless you tick it. A code an earlier show ran under still has to resolve on that show's program."
        >
          <div className="flex items-center gap-3 mb-2">
            <button
              type="button"
              onClick={() => setRetire(new Set(preview.retired.map((r) => r.code)))}
              className="text-xs underline"
              style={{ color: COLORS.link }}
            >
              Tick all
            </button>
            <button
              type="button"
              onClick={() => setRetire(new Set())}
              className="text-xs underline"
              style={{ color: COLORS.link }}
            >
              Clear
            </button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {preview.retired.map((row) => (
                <tr key={row.code} style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
                  <td className="py-1 pr-2 w-6 align-top">
                    <input
                      type="checkbox"
                      checked={retire.has(row.code)}
                      onChange={() => toggle(row.code)}
                      aria-label={`Retire ${row.code} ${row.name}`}
                    />
                  </td>
                  <td className="py-1 pr-3 font-mono align-top" style={{ color: COLORS.retired }}>
                    {row.code}
                  </td>
                  <td className="py-1 pr-3" style={{ color: COLORS.text }}>
                    {row.name}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap" style={{ color: COLORS.muted }}>
                    {row.division}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onApply}
          disabled={busy || nothingToDo}
          title={nothingToDo ? 'This file matches the catalog — nothing to apply' : undefined}
          className="rounded px-4 py-2 text-sm font-medium border disabled:opacity-50"
          style={{
            borderColor: COLORS.link,
            backgroundColor: busy || nothingToDo ? '#fff' : COLORS.link,
            color: busy || nothingToDo ? COLORS.muted : '#fff',
          }}
        >
          {busy ? 'Applying…' : 'Apply to catalog'}
        </button>
        <span className="text-xs" style={{ color: COLORS.muted }}>
          {preview.added.length} added, {preview.changed.length} changed,{' '}
          {retire.size} retired.
        </span>
      </div>
    </section>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
        {title}
      </h3>
      {hint && (
        <p className="text-xs mt-0.5 mb-1" style={{ color: COLORS.muted }}>
          {hint}
        </p>
      )}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">{children}</div>
    </div>
  );
}

function Notice({
  title,
  hint,
  items,
}: {
  title: string;
  hint?: string;
  items: string[];
}) {
  return (
    <div
      className="rounded border p-3 text-xs"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
    >
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-0.5">{hint}</p>}
      <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
        {items.map((item, i) => (
          <li key={i} className="font-mono">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
