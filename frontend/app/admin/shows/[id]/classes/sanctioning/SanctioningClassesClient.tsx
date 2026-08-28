'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export type SanctionedClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  entry_fee_cents: number;
};

export type ClubSanctioning = {
  association_id: string;
  code: string;
  name: string;
  per_class_fee_cents: number;
  class_ids: string[];
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function SanctioningClassesClient({
  showId,
  clubs,
  classes,
}: {
  showId: string;
  clubs: ClubSanctioning[];
  classes: SanctionedClass[];
}) {
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => {
    const base: Record<string, Set<string>> = {};
    for (const club of clubs) base[club.association_id] = new Set(club.class_ids);
    return base;
  });
  const [saved, setSaved] = useState<Record<string, Set<string>>>(() => {
    const base: Record<string, Set<string>> = {};
    for (const club of clubs) base[club.association_id] = new Set(club.class_ids);
    return base;
  });

  if (clubs.length === 0) {
    return (
      <div
        className="rounded border p-4 text-sm space-y-2"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
      >
        <p>
          This show does not carry any club sanctioning yet. Add NSBA, WSCA or
          MNSPHC in{' '}
          <Link
            href={`/admin/shows/${showId}/setup/sanctioning`}
            className="underline"
            style={{ color: '#8b4513' }}
          >
            Step 3
          </Link>{' '}
          and set what each one charges per class in{' '}
          <Link
            href={`/admin/shows/${showId}/setup/fees`}
            className="underline"
            style={{ color: '#8b4513' }}
          >
            Step 5
          </Link>
          , then come back here to say which classes they approve.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded border p-3 text-sm"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
      >
        A club approves a list of classes, not the whole show. Only the classes
        ticked here carry that club&apos;s per-class sanction fee — an exhibitor
        entering anything else is not charged for it.
      </div>

      {clubs.map((club) => (
        <ClubPanel
          key={club.association_id}
          showId={showId}
          club={club}
          classes={classes}
          selected={selected[club.association_id] ?? new Set()}
          savedSet={saved[club.association_id] ?? new Set()}
          onChange={(next) =>
            setSelected((prev) => ({ ...prev, [club.association_id]: next }))
          }
          onSaved={(next) =>
            setSaved((prev) => ({ ...prev, [club.association_id]: new Set(next) }))
          }
        />
      ))}
    </div>
  );
}

function ClubPanel({
  showId,
  club,
  classes,
  selected,
  savedSet,
  onChange,
  onSaved,
}: {
  showId: string;
  club: ClubSanctioning;
  classes: SanctionedClass[];
  selected: Set<string>;
  savedSet: Set<string>;
  onChange: (next: Set<string>) => void;
  onSaved: (next: Set<string>) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (selected.size !== savedSet.size) return true;
    for (const id of selected) if (!savedSet.has(id)) return true;
    return false;
  }, [selected, savedSet]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter(
      (c) =>
        c.class_name.toLowerCase().includes(q) ||
        c.class_number.toLowerCase().includes(q),
    );
  }, [classes, filter]);

  const byDay = useMemo(() => {
    const map = new Map<string, SanctionedClass[]>();
    for (const c of filtered) {
      const list = map.get(c.class_date) ?? [];
      list.push(c);
      map.set(c.class_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
    setOkMsg(null);
  }

  // Scoped to what the filter is showing, not to the whole schedule: someone who
  // has typed "Pleasure" to find the eleven pleasure classes means those eleven.
  function setAllVisible(on: boolean) {
    const next = new Set(selected);
    for (const c of filtered) {
      if (on) next.add(c.id);
      else next.delete(c.id);
    }
    onChange(next);
    setOkMsg(null);
  }

  async function save() {
    setError(null);
    setOkMsg(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/shows/${showId}/classes/sanctioning/${club.association_id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_ids: Array.from(selected) }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || `Could not save ${club.code} classes.`);
        return;
      }
      onSaved(selected);
      setOkMsg(
        selected.size === 0
          ? `${club.code} now sanctions no classes.`
          : `${club.code} sanctions ${selected.size} class${selected.size === 1 ? '' : 'es'}.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const visibleSelected = filtered.filter((c) => selected.has(c.id)).length;
  const unpriced = club.per_class_fee_cents === 0;

  return (
    <section
      className="rounded-lg border"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div className="p-4 space-y-2 border-b" style={{ borderColor: COLORS.borderSoft }}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            {club.name}{' '}
            <span className="font-mono text-xs" style={{ color: '#8b4513' }}>
              {club.code}
            </span>
          </h2>
          <span className="text-sm" style={{ color: COLORS.muted }}>
            {selected.size} of {classes.length} classes
            {!unpriced && (
              <>
                {' '}· {formatMoney(club.per_class_fee_cents)} per class ={' '}
                <strong style={{ color: COLORS.text }}>
                  {formatMoney(club.per_class_fee_cents * selected.size)}
                </strong>{' '}
                on an entry in every one
              </>
            )}
          </span>
        </div>

        {unpriced && (
          <p
            className="text-xs rounded px-2 py-1.5"
            style={{ backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
          >
            {club.code} has no per-class fee set, so ticking classes here charges
            nobody.{' '}
            <Link
              href={`/admin/shows/${showId}/setup/fees`}
              className="underline"
              style={{ color: '#8b4513' }}
            >
              Set it in Step 5
            </Link>
            .
          </p>
        )}
      </div>

      <div
        className="px-4 py-2 flex items-center gap-2 flex-wrap border-b"
        style={{ borderColor: COLORS.borderSoft }}
      >
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by number or name"
          className="text-sm border rounded px-2 py-1"
          style={{ borderColor: COLORS.border }}
        />
        <button
          type="button"
          onClick={() => setAllVisible(true)}
          className="text-xs rounded px-2 py-1 border"
          style={{ borderColor: COLORS.border, color: COLORS.warn }}
          title={
            filter.trim()
              ? `Tick the ${filtered.length} classes matching "${filter.trim()}"`
              : 'Tick every class in the show'
          }
        >
          Select {filter.trim() ? `matching (${filtered.length})` : 'all'}
        </button>
        <button
          type="button"
          onClick={() => setAllVisible(false)}
          className="text-xs rounded px-2 py-1 border"
          style={{ borderColor: COLORS.border, color: COLORS.warn }}
          title={
            filter.trim()
              ? `Untick the ${filtered.length} classes matching "${filter.trim()}"`
              : 'Untick every class in the show'
          }
        >
          Clear {filter.trim() ? `matching (${visibleSelected})` : 'all'}
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
        {byDay.length === 0 ? (
          <p className="p-3 text-sm" style={{ color: COLORS.muted }}>
            No matching classes.
          </p>
        ) : (
          byDay.map(([day, dayClasses]) => (
            <div key={day}>
              <div
                className="px-3 py-1.5 text-xs font-medium sticky top-0"
                style={{ backgroundColor: '#faf6f0', color: '#5c3d1e' }}
              >
                {formatDay(day)}
              </div>
              {dayClasses.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border-t cursor-pointer hover:bg-amber-50"
                  style={{ borderColor: COLORS.borderSoft }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span
                    className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                  >
                    #{c.class_number}
                  </span>
                  <span style={{ color: COLORS.text }}>{c.class_name}</span>
                  <span className="ml-auto text-xs" style={{ color: COLORS.muted }}>
                    {c.entry_fee_cents > 0 ? formatMoney(c.entry_fee_cents) : '—'}
                  </span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>

      <div
        className="p-3 flex items-center justify-between gap-3 flex-wrap border-t"
        style={{ borderColor: COLORS.borderSoft }}
      >
        <span className="text-sm" style={{ color: error ? '#922' : COLORS.muted }}>
          {error ?? okMsg ?? (dirty ? 'Unsaved changes.' : ' ')}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          title={dirty ? undefined : `No changes to ${club.code}'s class list.`}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Saving…' : `Save ${club.code} classes`}
        </button>
      </div>
    </section>
  );
}
