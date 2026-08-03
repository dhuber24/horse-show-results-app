'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import HorseDocuments, { HEALTH_DOC_TYPES } from '@/components/HorseDocuments';

interface Entry {
  id: string;
  class_id: string;
  exhibitor_id: string;
  horse_id: string | null;
  back_number: number | null;
  status: string;
  apha_division: string | null;
  relationship_to_owner: string | null;
  is_disqualified: boolean;
  horse_name?: string;
  horse?: { name: string };
  owner_name?: string | null;
  sire_name?: string | null;
  dam_name?: string | null;
  exhibitor_name?: string;
  exhibitor?: { full_name: string };
}

interface ClassGroup {
  cls: { id: string; class_number?: string; class_name?: string; name?: string; score_type?: string; class_date?: string };
  entries: Entry[];
}

function formatDateHeading(d: string | undefined): string {
  if (!d) return 'Unscheduled';
  // Parse as local midnight so a plain YYYY-MM-DD doesn't shift a day in
  // negative-offset timezones (new Date('2026-06-02') is parsed as UTC).
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

interface Props {
  showId: string;
  entriesByClass: ClassGroup[];
}

function entryHaystack(e: Entry): string {
  return [
    e.horse_name ?? e.horse?.name ?? '',
    e.exhibitor_name ?? e.exhibitor?.full_name ?? '',
    e.back_number != null ? `#${e.back_number} ${e.back_number}` : '',
    e.apha_division ?? '',
    e.owner_name ?? '',
    e.sire_name ?? '',
    e.dam_name ?? '',
  ].join(' ').toLowerCase();
}

function classHaystack(cls: ClassGroup['cls']): string {
  return [
    cls.class_number ?? '',
    cls.class_name ?? cls.name ?? '',
  ].join(' ').toLowerCase();
}

function EntryRow({ entry, showId, exhibitorEntryCount, onDeleted }: {
  entry: Entry;
  showId: string;
  exhibitorEntryCount: number;
  onDeleted: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPapers, setShowPapers] = useState(false);

  const horseName = entry.horse_name ?? entry.horse?.name ?? '(unknown horse)';
  const exhibitorName = entry.exhibitor_name ?? entry.exhibitor?.full_name ?? '(unknown exhibitor)';

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(
      `/api/entries/${entry.id}?showId=${showId}&classId=${entry.class_id}`,
      { method: 'DELETE' }
    );
    setDeleting(false);
    if (res.ok || res.status === 204) {
      onDeleted(entry.id);
    } else {
      setConfirmDelete(false);
      setError('Failed to delete entry.');
    }
  };

  return (
    <>
    <tr className="border-t align-top" style={{ borderColor: '#f0e6d6' }}>
      <td className="py-1.5 pr-3 font-mono whitespace-nowrap" style={{ color: '#8b4513' }}>
        {entry.back_number != null ? `#${entry.back_number}` : '—'}
        {entry.is_disqualified && (
          <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">DQ</span>
        )}
      </td>
      <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>{horseName}</td>
      <td className="py-1.5 pr-3" style={{ color: '#5a3e2b' }}>{entry.owner_name || '—'}</td>
      <td className="py-1.5 pr-3" style={{ color: '#8b7355' }}>{entry.sire_name || '—'}</td>
      <td className="py-1.5 pr-3" style={{ color: '#8b7355' }}>{entry.dam_name || '—'}</td>
      <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>
        {exhibitorName}
        {entry.apha_division && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: '#e8d5b7', color: '#5c3d1e' }}>
            {entry.apha_division.replace(/_/g, ' ')}
          </span>
        )}
        {exhibitorEntryCount > 1 && (
          <span
            className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap"
            title={`This exhibitor has ${exhibitorEntryCount} entries in this class`}
          >
            ⚠ {exhibitorEntryCount} horses
          </span>
        )}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {error && <span className="text-xs text-red-600 mr-2">{error}</span>}
        {entry.horse_id && (
          <button
            onClick={() => setShowPapers(v => !v)}
            className="text-xs hover:underline mr-3"
            style={{ color: '#8b4513' }}
            title={`Health documents on file for ${horseName}`}
          >
            {showPapers ? 'Hide papers' : 'Papers'}
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-xs hover:underline text-red-600"
        >
          Remove
        </button>

        {confirmDelete && (
          <ConfirmDialog
            title="Remove Entry"
            message={`Remove ${exhibitorName}'s entry for ${horseName}? This cannot be undone.`}
            confirmLabel="Yes, remove"
            destructive
            confirming={deleting}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </td>
    </tr>
    {showPapers && entry.horse_id && (
      <tr style={{ backgroundColor: '#faf7f2' }}>
        <td colSpan={7} className="px-3 py-3">
          <p className="text-xs font-semibold mb-2" style={{ color: '#5c3d1e' }}>
            Health documents — {horseName}
          </p>
          <HorseDocuments
            horseId={entry.horse_id}
            types={HEALTH_DOC_TYPES}
            emptyLabel="No health documents uploaded for this horse."
            readOnly
          />
        </td>
      </tr>
    )}
    </>
  );
}

export default function EntryListSection({ showId, entriesByClass }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<ClassGroup[]>(entriesByClass);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const normalizedQuery = query.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;

  const visibleGroups = useMemo(() => {
    if (!isFiltering) {
      return groups.map(g => ({ group: g, matchedEntries: g.entries }));
    }
    return groups.flatMap(g => {
      const classMatches = classHaystack(g.cls).includes(normalizedQuery);
      const entryMatches = g.entries.filter(e => entryHaystack(e).includes(normalizedQuery));
      if (classMatches) {
        return [{ group: g, matchedEntries: g.entries }];
      }
      if (entryMatches.length > 0) {
        return [{ group: g, matchedEntries: entryMatches }];
      }
      return [];
    });
  }, [groups, normalizedQuery, isFiltering]);

  // Group the visible classes by their date for date-separated headers.
  // groups arrive in (class_date, sort_order, class_number) order from the
  // backend, so consecutive same-date entries cluster naturally.
  const visibleByDate = useMemo(() => {
    const out: { date: string | undefined; items: typeof visibleGroups }[] = [];
    for (const v of visibleGroups) {
      const d = v.group.cls.class_date;
      const last = out[out.length - 1];
      if (last && last.date === d) last.items.push(v);
      else out.push({ date: d, items: [v] });
    }
    return out;
  }, [visibleGroups]);

  const totalEntries = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups]
  );
  const totalMatched = useMemo(
    () => visibleGroups.reduce((sum, v) => sum + v.matchedEntries.length, 0),
    [visibleGroups]
  );

  const handleDeleted = (classId: string, entryId: string) => {
    setGroups(prev => prev.map(g =>
      g.cls.id !== classId ? g : {
        ...g,
        entries: g.entries.filter(e => e.id !== entryId),
      }
    ));
    router.refresh();
  };

  const toggleClass = (classId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(groups.map(g => g.cls.id)));
  const collapseAll = () => setExpanded(new Set());

  if (groups.length === 0) {
    return <p style={{ color: '#8b7355' }}>No classes yet. Add a class first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by horse, exhibitor, back #, or class…"
          className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
        {!isFiltering && (
          <div className="flex gap-2 text-xs">
            <button
              onClick={expandAll}
              className="px-2 py-1 rounded border hover:bg-amber-50"
              style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="px-2 py-1 rounded border hover:bg-amber-50"
              style={{ borderColor: '#d4b896', color: '#5a3e2b' }}
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {isFiltering && (
        <p className="text-xs" style={{ color: '#8b7355' }}>
          {totalMatched === 0
            ? 'No entries match.'
            : `Showing ${totalMatched} of ${totalEntries} entries across ${visibleGroups.length} class${visibleGroups.length === 1 ? '' : 'es'}.`}
        </p>
      )}

      {visibleGroups.length === 0 ? null : (
        <div className="space-y-5">
          {visibleByDate.map(({ date, items }) => (
            <div key={date ?? 'unscheduled'} className="space-y-2">
              <div
                className="flex items-baseline gap-2 pb-1 border-b"
                style={{ borderColor: '#d4b896' }}
              >
                <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: '#8b4513' }}>
                  {formatDateHeading(date)}
                </h3>
                <span className="text-xs" style={{ color: '#8b7355' }}>
                  {items.length} class{items.length === 1 ? '' : 'es'}
                </span>
              </div>
              {items.map(({ group: { cls, entries: allEntries }, matchedEntries }) => {
            const isOpen = isFiltering || expanded.has(cls.id);
            const countByExhibitor = matchedEntries.reduce<Record<string, number>>((acc, e) => {
              acc[e.exhibitor_id] = (acc[e.exhibitor_id] ?? 0) + 1;
              return acc;
            }, {});
            const matchInfo =
              isFiltering && matchedEntries.length !== allEntries.length
                ? `${matchedEntries.length} of ${allEntries.length}`
                : String(allEntries.length);

            return (
              <div
                key={cls.id}
                className="rounded-lg border"
                style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
              >
                <button
                  type="button"
                  onClick={() => !isFiltering && toggleClass(cls.id)}
                  disabled={isFiltering}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-50 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="flex items-center gap-2 font-semibold" style={{ color: '#2c1810' }}>
                    <span
                      className="inline-block w-4 text-center text-sm"
                      style={{ color: '#8b4513' }}
                      aria-hidden
                    >
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <span>
                      {cls.class_number != null ? `${cls.class_number} — ` : ''}
                      {cls.class_name ?? cls.name ?? 'Class'}
                    </span>
                    <span className="text-sm font-normal" style={{ color: '#8b7355' }}>
                      ({matchInfo})
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3">
                    {matchedEntries.length === 0 ? (
                      <p className="text-sm" style={{ color: '#8b7355' }}>No entries yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="text-xs uppercase tracking-wide" style={{ color: '#8b4513' }}>
                              <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Back #</th>
                              <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                              <th className="text-left font-semibold pb-1 pr-3">Owner</th>
                              <th className="text-left font-semibold pb-1 pr-3">Sire</th>
                              <th className="text-left font-semibold pb-1 pr-3">Dam</th>
                              <th className="text-left font-semibold pb-1 pr-3">Exhibitor</th>
                              <th className="pb-1"><span className="sr-only">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {matchedEntries.map(entry => (
                              <EntryRow
                                key={entry.id}
                                entry={entry}
                                showId={showId}
                                exhibitorEntryCount={countByExhibitor[entry.exhibitor_id] ?? 1}
                                onDeleted={id => handleDeleted(cls.id, id)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
