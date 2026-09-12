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

/**
 * One person on the roster, however many exhibitor records they turn up under.
 *
 * A back number lives on the exhibitor record, one per show, so somebody who
 * appears twice with two numbers is two records with the same name — an old
 * account's record left behind when the account went and a new one made when
 * they signed up again, or a walk-up the office typed in before finding the
 * existing profile. Listing each record as its own row put the same person on
 * the desk twice. Grouped by name here, every back number's details sit under
 * one entry; nothing is merged, and each record keeps its own panel, classes,
 * paperwork and account, because a name is not proof two records are the same
 * person and the office can see both side by side to judge.
 */
type PersonGroup = { key: string; name: string; members: DeskExhibitor[] };

function personKey(exhibitor: DeskExhibitor): string {
  return exhibitor.exhibitor_name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The live registration first, then a desk-added one, then a cancelled one. */
function memberRank(exhibitor: DeskExhibitor): number {
  if (exhibitor.cancelled_at) return 2;
  return exhibitor.signed_up ? 0 : 1;
}

function groupByPerson(exhibitors: DeskExhibitor[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const exhibitor of exhibitors) {
    const key = personKey(exhibitor);
    const group = groups.get(key) ?? { key, name: exhibitor.exhibitor_name, members: [] };
    group.members.push(exhibitor);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.members.sort(
      (a, b) =>
        memberRank(a) - memberRank(b) ||
        (a.back_number ?? Number.MAX_SAFE_INTEGER) - (b.back_number ?? Number.MAX_SAFE_INTEGER),
    );
    group.name = group.members[0].exhibitor_name;
  }
  // The backend already sorts the roster alphabetically; Map keeps that order.
  return Array.from(groups.values());
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

  const people = useMemo(() => groupByPerson(desk?.exhibitors ?? []), [desk]);

  // A person is listed when any of their records matches — somebody searched
  // for by the back number on their older record is still the same person.
  const shown = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return people.filter((group) =>
      group.members.some(
        (e) =>
          matchesFilter(e, filter) &&
          (tokens.length === 0 || tokens.every((t) => haystack(e).includes(t))),
      ),
    );
  }, [people, query, filter]);

  // Selection is still an exhibitor id — the by-class view and the add form both
  // hand one over — and the panel shows the whole person that record belongs to.
  const selectedGroup = useMemo(
    () => people.find((g) => g.members.some((e) => e.exhibitor_id === selectedId)) ?? null,
    [people, selectedId],
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
        <Stat label="Exhibitors" value={String(people.length)} />
        <Stat label="Entries" value={String(t.entries)} />
        <Stat
          label="No back #"
          value={String(t.no_back_number)}
          tone={t.no_back_number > 0 ? 'var(--warning)' : undefined}
        />
        <Stat
          label="Paperwork to check"
          value={String(t.paperwork_outstanding)}
          tone={t.paperwork_outstanding > 0 ? 'var(--warning)' : undefined}
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
                    ? people.length
                    : people.filter((g) => g.members.some((e) => matchesFilter(e, f))).length;
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
                        ? { backgroundColor: COLORS.accent, borderColor: COLORS.accent, color: 'var(--surface)' }
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
                {shown.map((group) => {
                  const members = group.members;
                  const isSelected = selectedGroup?.key === group.key;
                  const classCount = members.reduce((n, e) => n + e.entries.length, 0);
                  const potCount = members.reduce((n, e) => n + e.side_pot_ids.length, 0);
                  const toCheck = members.reduce((n, e) => n + e.paperwork_outstanding, 0);
                  const alerts = members.some((e) => healthAlerts(e).length > 0);
                  const unsigned = members.some((e) => unsignedWaivers(e).length > 0);
                  const owing = members.reduce((n, e) => n + Math.max(e.balance_cents, 0), 0);
                  const numbers = members
                    .map((e) => e.back_number)
                    .filter((n): n is number => n != null)
                    .map((n) => `#${n}`);
                  return (
                    <li key={group.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(members[0].exhibitor_id)}
                        className="w-full text-left px-3 py-2.5 transition-colors hover:bg-amber-50"
                        style={isSelected ? { backgroundColor: 'var(--bg-subtle)' } : undefined}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium truncate" style={{ color: COLORS.text }}>
                            {group.name}
                          </span>
                          <span className="font-mono text-sm shrink-0" style={{ color: COLORS.accent }}>
                            {numbers.length > 0 ? numbers.join(' · ') : '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1 text-xs" style={{ color: COLORS.muted }}>
                          <span>{classCount} class{classCount === 1 ? '' : 'es'}</span>
                          {members.length > 1 && <span>· {members.length} registrations</span>}
                          {potCount > 0 && <span>· {potCount} pot{potCount === 1 ? '' : 's'}</span>}
                          {toCheck > 0 && (
                            <span style={{ color: 'var(--warning)' }}>· {toCheck} to check</span>
                          )}
                          {alerts && <span style={{ color: 'var(--error-strong)' }}>· ⚠ health</span>}
                          {unsigned && <span style={{ color: 'var(--warning)' }}>· unsigned</span>}
                          {owing > 0 && (
                            <span style={{ color: 'var(--error)' }}>· {formatMoney(owing)} owing</span>
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
            {selectedGroup ? (
              <div className="space-y-6">
                {selectedGroup.members.length > 1 && (
                  <div
                    className="rounded-lg border p-3 text-sm"
                    style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
                  >
                    <strong>{selectedGroup.name}</strong> is on this show under{' '}
                    {selectedGroup.members.length} exhibitor records, each with its own back number,
                    classes, paperwork and account — shown together below. If they are the same
                    person, remove the one that should not be here.
                  </div>
                )}
                {selectedGroup.members.map((member, index) => (
                  <div key={member.exhibitor_id} className="space-y-2">
                    {selectedGroup.members.length > 1 && (
                      <p
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: COLORS.accent }}
                      >
                        {member.back_number != null ? `Back #${member.back_number}` : 'No back number'}
                        {' · '}
                        {member.cancelled_at
                          ? 'cancelled registration'
                          : member.signed_up
                            ? 'signed up'
                            : 'added at the desk'}
                      </p>
                    )}
                    <ExhibitorPanel
                      showId={showId}
                      desk={desk}
                      exhibitor={member}
                      associations={associations}
                      breeds={breeds}
                      colors={colors}
                      onChanged={load}
                      onRemoved={() => {
                        // Keep the person open on whichever record is left.
                        const next = selectedGroup.members.find((_, i) => i !== index);
                        setSelectedId(next?.exhibitor_id ?? null);
                      }}
                    />
                  </div>
                ))}
              </div>
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
