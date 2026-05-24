'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getShowDates } from './showDateUtils';

type ScoreType = 'placement' | 'pattern' | 'time';

interface Section {
  id: string;
  name: string;
}

interface ParsedClass {
  name: string;
  bracket?: string;
}

interface PreviewItem {
  name: string;
  bracket: string;
  auto_discipline: string | null;
  auto_score_type: ScoreType;
  routed_division: string;
  routed_section: string;
  is_unassigned: boolean;
}

interface PreviewGroup {
  division: string;
  sections: { section: string; count: number }[];
  count: number;
}

interface PreviewData {
  items: PreviewItem[];
  groups: PreviewGroup[];
  unrouted_count: number;
}

const SCORE_LABEL: Record<ScoreType, string> = {
  placement: 'Placement',
  pattern: 'Pattern',
  time: 'Time',
};

function parseLines(text: string): ParsedClass[] {
  const seen = new Set<string>();
  const parsed: ParsedClass[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cleaned = line.replace(/^#?\d+[\).:-]\s+/, '').trim();
    const [rawName, rawBracket] = cleaned.split('|').map((part) => part.trim());
    if (!rawName) continue;
    const bracket = rawBracket || undefined;
    const key = `${rawName.toLowerCase()}|${(bracket ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ name: rawName, bracket });
  }
  return parsed;
}

function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export default function BulkClassFromTextImporter({
  showId,
  showStartDate,
  showEndDate,
  sections,
}: {
  showId: string;
  showStartDate: string;
  showEndDate: string;
  sections: Section[];
}) {
  const router = useRouter();
  const showDates = useMemo(() => getShowDates(showStartDate, showEndDate), [showStartDate, showEndDate]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [defaultBracket, setDefaultBracket] = useState('');
  const [customBracket, setCustomBracket] = useState('');
  const [classDate, setClassDate] = useState(showStartDate);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const parsed = useMemo(() => parseLines(text), [text]);
  const effectiveDefaultBracket = defaultBracket === '__custom__' ? customBracket.trim() : defaultBracket;
  const body = useMemo(
    () => ({
      default_bracket: effectiveDefaultBracket || null,
      classes: parsed,
    }),
    [effectiveDefaultBracket, parsed],
  );

  const runPreview = async () => {
    if (parsed.length === 0) {
      setError('Paste at least one class name.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessCount(null);
    const res = await fetch(`/api/shows/${showId}/classes/bulk-from-names/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setPreview(await res.json());
    } else {
      const err = await res.json().catch(() => ({}));
      setError(errorMessage(err.detail, 'Failed to preview classes.'));
    }
  };

  const addClasses = async () => {
    if (parsed.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccessCount(null);
    const res = await fetch(`/api/shows/${showId}/classes/bulk-from-names`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, class_date: classDate }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setSuccessCount(Array.isArray(data) ? data.length : parsed.length);
      setText('');
      setPreview(null);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(errorMessage(err.detail, 'Failed to add classes.'));
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-4 py-2 rounded border font-medium hover:bg-amber-50"
        style={{ borderColor: '#c9a96e', color: '#7c5c2e' }}
      >
        + Paste Class List
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: '#c9a96e', background: '#fffdf8' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold" style={{ color: '#2c1810' }}>Paste Class List</h3>
        <button onClick={() => setOpen(false)} className="text-sm" style={{ color: '#8b7355' }}>
          Close
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setSuccessCount(null);
        }}
        placeholder={'Western Pleasure | Open\n10 & Under Showmanship\nTrail | Amateur'}
        rows={8}
        className="w-full border rounded px-3 py-2 text-sm font-mono"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Default bracket</label>
          <select
            value={defaultBracket}
            onChange={(e) => {
              setDefaultBracket(e.target.value);
              setPreview(null);
            }}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          >
            <option value="">Unassigned</option>
            {sections.map((section) => (
              <option key={section.id} value={section.name}>{section.name}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
        </div>
        {defaultBracket === '__custom__' && (
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Custom bracket</label>
            <input
              value={customBracket}
              onChange={(e) => {
                setCustomBracket(e.target.value);
                setPreview(null);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: '#d4b896' }}
            />
          </div>
        )}
        <div>
          <label className="block text-xs mb-1" style={{ color: '#8b7355' }}>Class date</label>
          <select
            value={classDate}
            onChange={(e) => setClassDate(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          >
            {showDates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={runPreview}
          disabled={busy || parsed.length === 0}
          className="px-4 py-2 rounded border font-medium disabled:opacity-50"
          style={{ borderColor: '#d4b896', color: '#7c5c2e' }}
        >
          {busy ? 'Working...' : `Preview ${parsed.length || ''}`.trim()}
        </button>
        <button
          onClick={addClasses}
          disabled={busy || parsed.length === 0}
          className="px-4 py-2 rounded font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          {busy ? 'Adding...' : `Add ${parsed.length || ''} Classes`.trim()}
        </button>
        {successCount !== null && (
          <span className="text-sm" style={{ color: '#3f6b2f' }}>
            Added {successCount} class{successCount === 1 ? '' : 'es'}.
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {preview && (
        <div className="rounded border p-3 text-xs space-y-3" style={{ borderColor: '#c9a96e', background: '#faf6ef' }}>
          <div>
            <p className="font-medium mb-2" style={{ color: '#5c3d1e' }}>Routing preview</p>
            <ul className="space-y-1">
              {preview.groups.map((group) => (
                <li key={group.division} className="flex items-start gap-2">
                  <span
                    className="font-medium"
                    style={{ color: group.division === 'Unassigned' ? '#b45309' : '#3f6b2f' }}
                  >
                    {group.division}
                  </span>
                  <span style={{ color: '#8b7355' }}>
                    ({group.sections.map((s) => `${s.section} x${s.count}`).join(', ')})
                  </span>
                </li>
              ))}
            </ul>
            {preview.unrouted_count > 0 && (
              <p className="mt-2" style={{ color: '#b45309' }}>
                {preview.unrouted_count} class{preview.unrouted_count === 1 ? '' : 'es'} will land in Unassigned.
              </p>
            )}
          </div>
          <div className="border-t pt-2 space-y-1" style={{ borderColor: '#e8d5b7' }}>
            {preview.items.slice(0, 8).map((item) => (
              <div key={`${item.name}-${item.bracket}`} className="flex flex-wrap gap-x-2">
                <span style={{ color: '#2c1810' }}>{item.name}</span>
                <span style={{ color: '#8b7355' }}>-&gt; {item.routed_division} / {item.routed_section}</span>
                <span style={{ color: '#7c5c2e' }}>{SCORE_LABEL[item.auto_score_type]}</span>
              </div>
            ))}
            {preview.items.length > 8 && (
              <p style={{ color: '#8b7355' }}>...and {preview.items.length - 8} more.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
