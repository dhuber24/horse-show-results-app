'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AddExhibitorForm from './AddExhibitorForm';
import ByClassView from './ByClassView';
import CogginsOverridePanel from './CogginsOverridePanel';
import ExhibitorPanel from './ExhibitorPanel';
import type { AssociationOption, LookupOption } from './StaffAddHorseForm';
import { COLORS, healthAlerts, unsignedWaivers } from './types';
import type { Desk, DeskExhibitor } from './types';
import { formatMoney } from '@/lib/financials';

type View = 'exhibitors' | 'classes';
type Filter = 'all' | 'no_back_number' | 'paperwork' | 'health' | 'waivers' | 'no_entries';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Everyone',
  no_back_number: 'No back number',
  paperwork: 'Paperwork to check',
  health: 'Health flags',
  waivers: 'Unsigned releases',
  no_entries: 'No classes yet',
};

function matchesFilter(exhibitor: DeskExhibitor, filter: Filter): boolean {
  switch (filter) {
    case 'no_back_number':
      return exhibitor.back_number === null;
    case 'paperwork':
      return exhibitor.paperwork_outstanding > 0;
    case 'health':
      return healthAlerts(exhibitor).length > 0;
    case 'waivers':
      return unsignedWaivers(exhibitor).length > 0;
    case 'no_entries':
      return exhibitor.entries.length === 0;
    default:
      return true;
  }
}

function haystack(exhibitor: DeskExhibitor): string {
  return [
    exhibitor.exhibitor_name,
    exhibitor.back_number != null ? `#${exhibitor.back_number} ${exhibitor.back_number}` : '',
    ...exhibitor.horses.map((h) => `${h.horse_name} ${h.barn_name ?? ''}`),
    ...exhibitor.entries.map((e) => `${e.horse_name ?? ''} ${e.class_number ?? ''} ${e.class_name ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide" style={{ color: COLORS.muted }}>{label}</p>
      <p className="text-lg font-semibold" style={{ color: tone ?? COLORS.text }}>{value}</p>
    </div>
  );
}

export default function DeskClient({
  showId,
  associations,
  breeds,
  colors,
}: {
  showId: string;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
}) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('exhibitors');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shows/${showId}/desk`, { cache: 'no-store' });
    if (!res.ok) {
      setLoadError('Could not load the desk. Reload the page to try again.');
      setLoading(false);
      return;
    }
    setDesk(await res.json());
    setLoadError(null);
    setLoading(false);
  }, [showId]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!desk) return [];
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return desk.exhibitors
      .filter((e) => matchesFilter(e, filter))
      .filter((e) => {
        if (tokens.length === 0) return true;
        const hay = haystack(e);
        return tokens.every((t) => hay.includes(t));
      });
  }, [desk, query, filter]);

  const selected = useMemo(
    () => desk?.exhibitors.find((e) => e.exhibitor_id === selectedId) ?? null,
    [desk, selectedId],
  );

  // A selection that filters itself out of the list stays open — the desk is
  // mid-conversation with that person, and giving them a back number should not
  // close their panel just because "No back number" was the active filter.
  const rosterIds = useMemo(
    () => new Set((desk?.exhibitors ?? []).map((e) => e.exhibitor_id)),
    [desk],
  );

  if (loading) return <p style={{ color: COLORS.muted }}>Loading the desk…</p>;
  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!desk) return null;

  const t = desk.totals;

  return (
    <div className="space-y-4">
      {/* Counts of registration work, and nothing else. What the show is owed in
          total is a Financials question — an exhibitor's own balance still shows
          on their panel, because they may be paying it at this counter. */}
      <div
        className="rounded-lg border p-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
      >
        <Stat label="Exhibitors" value={String(t.exhibitors)} />
        <Stat label="Entries" value={String(t.entries)} />
        <Stat
          label="No back #"
          value={String(t.no_back_number)}
          tone={t.no_back_number > 0 ? '#92400e' : undefined}
        />
        <Stat
          label="Paperwork to check"
          value={String(t.paperwork_outstanding)}
          tone={t.paperwork_outstanding > 0 ? '#92400e' : undefined}
        />
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: COLORS.border }}>
        {(['exhibitors', 'classes'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-current={view === v ? 'page' : undefined}
            className="px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors"
            style={
              view === v
                ? { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.text }
                : { backgroundColor: 'transparent', borderColor: 'transparent', color: COLORS.muted }
            }
          >
            {v === 'exhibitors' ? 'By exhibitor' : 'By class'}
          </button>
        ))}
      </div>

      {view === 'classes' ? (
        <ByClassView
          showId={showId}
          desk={desk}
          onChanged={load}
          onPickExhibitor={(exhibitorId) => {
            setSelectedId(exhibitorId);
            setFilter('all');
            setQuery('');
            setView('exhibitors');
          }}
        />
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, back #, horse…"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.text }}
            />

            <div className="flex flex-wrap gap-1">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => {
                const count =
                  f === 'all'
                    ? desk.exhibitors.length
                    : desk.exhibitors.filter((e) => matchesFilter(e, f)).length;
                const disabled = f !== 'all' && count === 0 && filter !== f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    disabled={disabled}
                    title={disabled ? `Nobody at this show is in "${FILTER_LABELS[f]}"` : undefined}
                    className="text-xs font-medium px-2.5 py-1 rounded-full border transition disabled:opacity-40"
                    style={
                      filter === f
                        ? { backgroundColor: COLORS.accent, borderColor: COLORS.accent, color: '#ffffff' }
                        : { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.accent }
                    }
                  >
                    {FILTER_LABELS[f]} {count > 0 && <span className="opacity-70">{count}</span>}
                  </button>
                );
              })}
            </div>

            {adding ? (
              <AddExhibitorForm
                showId={showId}
                onRosterIds={rosterIds}
                onAdded={async (exhibitorId) => {
                  setAdding(false);
                  setFilter('all');
                  setQuery('');
                  await load();
                  setSelectedId(exhibitorId);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full border-2 border-dashed rounded-lg p-2.5 text-sm font-medium hover:bg-amber-50 transition-colors"
                style={{ borderColor: COLORS.border, color: COLORS.accent }}
              >
                + Add someone to this show
              </button>
            )}

            {shown.length === 0 ? (
              <p className="text-sm px-1 py-3" style={{ color: COLORS.muted }}>
                {desk.exhibitors.length === 0
                  ? 'Nobody is on this show’s roster yet. Exhibitors appear here once they sign up, or add one above.'
                  : 'Nobody matches.'}
              </p>
            ) : (
              <ul
                className="rounded-lg border divide-y overflow-hidden lg:max-h-[70vh] lg:overflow-y-auto"
                style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
              >
                {shown.map((ex) => {
                  const isSelected = ex.exhibitor_id === selectedId;
                  const alerts = healthAlerts(ex).length;
                  const unsigned = unsignedWaivers(ex).length;
                  return (
                    <li key={ex.exhibitor_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(ex.exhibitor_id)}
                        className="w-full text-left px-3 py-2.5 transition-colors hover:bg-amber-50"
                        style={isSelected ? { backgroundColor: '#f5ede0' } : undefined}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium truncate" style={{ color: COLORS.text }}>
                            {ex.exhibitor_name}
                          </span>
                          <span className="font-mono text-sm shrink-0" style={{ color: COLORS.accent }}>
                            {ex.back_number != null ? `#${ex.back_number}` : '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1 text-xs" style={{ color: COLORS.muted }}>
                          <span>{ex.entries.length} class{ex.entries.length === 1 ? '' : 'es'}</span>
                          {ex.side_pot_ids.length > 0 && <span>· {ex.side_pot_ids.length} pot{ex.side_pot_ids.length === 1 ? '' : 's'}</span>}
                          {ex.paperwork_outstanding > 0 && (
                            <span style={{ color: '#92400e' }}>· {ex.paperwork_outstanding} to check</span>
                          )}
                          {alerts > 0 && <span style={{ color: '#991b1b' }}>· ⚠ health</span>}
                          {unsigned > 0 && <span style={{ color: '#92400e' }}>· unsigned</span>}
                          {ex.balance_cents > 0 && (
                            <span style={{ color: '#b42318' }}>· {formatMoney(ex.balance_cents)} owing</span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            {selected ? (
              <ExhibitorPanel
                showId={showId}
                desk={desk}
                exhibitor={selected}
                associations={associations}
                breeds={breeds}
                colors={colors}
                onChanged={load}
                onRemoved={() => setSelectedId(null)}
              />
            ) : (
              <div
                className="rounded-lg border p-8 text-center"
                style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
              >
                <p className="text-sm" style={{ color: COLORS.muted }}>
                  Pick someone from the list to give them a back number, enter their classes, put
                  them in a side pot, and check their paperwork — all from here.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <CogginsOverridePanel showId={showId} />
    </div>
  );
}
