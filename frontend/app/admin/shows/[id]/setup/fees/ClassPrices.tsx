'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import { hashNumber } from '@/lib/class-number';
import { AutosaveNavLink, useRegisterUnsavedChanges } from '../_lib/StepAutosave';

/** A class as `GET /shows/{id}/classes/` returns it — only what pricing reads. */
export type ClassPriceRow = {
  id: string;
  class_number: string;
  class_name: string;
  entry_fee_cents: number;
  is_free?: boolean;
  entered_by_qualification?: boolean;
  is_futurity_class?: boolean;
  sanctioning_codes?: string[];
  /** Riders on one entry (migration 192); null for one rider. */
  team_size?: number | null;
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  subtle: 'var(--border-subtle)',
  bg: 'var(--surface)',
  accent: 'var(--accent)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

type GroupKey = 'unpriced' | 'free' | `c${number}`;

type Group = {
  key: GroupKey;
  /** The price every class in it carries; null for Free. */
  cents: number | null;
  classes: ClassPriceRow[];
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFrom(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

/** Classes nobody prices on this step: a futurity's are priced by its
 *  categories (Step 6), and one reached by qualification has no entry. */
function pricedHere(c: ClassPriceRow): boolean {
  return !c.is_futurity_class && !c.entered_by_qualification;
}

function groupKey(c: ClassPriceRow): GroupKey {
  if (c.is_free) return 'free';
  if (c.entry_fee_cents <= 0) return 'unpriced';
  return `c${c.entry_fee_cents}`;
}

/** Unpriced first (the thing to fix), then by price, then Free. */
function groupClasses(classes: ClassPriceRow[]): Group[] {
  const map = new Map<GroupKey, Group>();
  for (const c of classes.filter(pricedHere)) {
    const key = groupKey(c);
    const group = map.get(key) ?? {
      key,
      cents: key === 'free' ? null : key === 'unpriced' ? 0 : c.entry_fee_cents,
      classes: [],
    };
    group.classes.push(c);
    map.set(key, group);
  }
  const rank = (g: Group) => (g.key === 'unpriced' ? -1 : g.key === 'free' ? Number.MAX_SAFE_INTEGER : g.cents ?? 0);
  return [...map.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * What each class costs to enter, grouped by price.
 *
 * A show bill prices its classes in a handful of rates — "Single class $20",
 * "Double class $40", "Jackpot pleasure $50" — and the bill reader writes the
 * rate onto each class it applies to. Those prices used to be visible only
 * class by class in the Class Builder, so this step, the one named for fees,
 * looked as if the bill's entry fee table had never been read. Here each rate
 * is one row: change its price and every class in it is repriced in one write
 * (`POST /classes/entry-fee`); open it to move a single class to another price.
 */
export default function ClassPrices({
  showId,
  initialClasses,
}: {
  showId: string;
  initialClasses: ClassPriceRow[];
}) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const groups = useMemo(() => groupClasses(classes), [classes]);
  const [groupDrafts, setGroupDrafts] = useState<Partial<Record<GroupKey, string>>>({});
  const [classDrafts, setClassDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Partial<Record<GroupKey, boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entryFeesHref = `/admin/shows/${showId}/fees/entry`;
  const futurityCount = classes.filter((c) => c.is_futurity_class).length;
  const qualifyingCount = classes.filter((c) => c.entered_by_qualification && !c.is_futurity_class).length;

  const isDirty = () =>
    groups.some((g) => {
      const draft = groupDrafts[g.key];
      return draft !== undefined && centsFrom(draft) !== null && centsFrom(draft) !== g.cents;
    }) ||
    classes.some((c) => {
      const draft = classDrafts[c.id];
      return draft !== undefined && centsFrom(draft) !== null && centsFrom(draft) !== c.entry_fee_cents;
    });
  useRegisterUnsavedChanges(isDirty);

  async function price(ids: string[], cents: number, savingKey: string): Promise<boolean> {
    setSaving(savingKey);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/classes/entry-fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_ids: ids, entry_fee_cents: cents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(errorMessage(body, 'Could not save that price.'));
        return false;
      }
      const set = new Set(ids);
      setClasses((prev) => prev.map((c) => (set.has(c.id) ? { ...c, entry_fee_cents: cents } : c)));
      router.refresh();
      return true;
    } finally {
      setSaving(null);
    }
  }

  async function applyGroup(group: Group) {
    const cents = centsFrom(groupDrafts[group.key] ?? '');
    if (cents === null) return;
    const ok = await price(group.classes.map((c) => c.id), cents, group.key);
    if (ok) {
      setGroupDrafts((prev) => ({ ...prev, [group.key]: undefined }));
      setClassDrafts((prev) => {
        const next = { ...prev };
        for (const c of group.classes) delete next[c.id];
        return next;
      });
    }
  }

  async function applyClass(cls: ClassPriceRow) {
    const cents = centsFrom(classDrafts[cls.id] ?? '');
    if (cents === null) return;
    const ok = await price([cls.id], cents, cls.id);
    if (ok) {
      setClassDrafts((prev) => {
        const next = { ...prev };
        delete next[cls.id];
        return next;
      });
    }
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Class prices
        </h2>
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          What each class costs to enter, grouped by price. Change a price to reprice every class in
          its group, or open the group to move one class to another price.
        </p>
      </div>

      {error && (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No classes to price yet. Add them in Step 4: Classes.
        </p>
      ) : (
        <ul className="divide-y rounded border" style={{ borderColor: COLORS.subtle }}>
          {groups.map((group) => {
            const n = group.classes.length;
            const draft = groupDrafts[group.key];
            const shown = draft ?? (group.cents ? dollars(group.cents) : '');
            const parsed = centsFrom(shown);
            const dirty = draft !== undefined && parsed !== null && parsed !== group.cents;
            const isOpen = open[group.key] ?? group.key === 'unpriced';
            const title =
              group.key === 'free' ? 'Free' : group.key === 'unpriced' ? 'No price yet' : `$${dollars(group.cents ?? 0)}`;
            return (
              <li key={group.key} className="p-3 space-y-2" style={{ borderColor: COLORS.subtle }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[10rem]">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: group.key === 'unpriced' ? COLORS.warn : COLORS.text }}
                    >
                      {title}
                    </span>
                    <span className="text-sm" style={{ color: COLORS.muted }}>
                      {' · '}
                      {n} class{n === 1 ? '' : 'es'}
                    </span>
                  </div>
                  {group.key !== 'free' && (
                    <div className="flex items-center gap-2">
                      <div className="relative w-24">
                        <span
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
                          style={{ color: COLORS.muted }}
                        >
                          $
                        </span>
                        <input
                          inputMode="decimal"
                          value={shown}
                          placeholder={group.key === 'unpriced' ? '0.00' : undefined}
                          onChange={(e) => setGroupDrafts((prev) => ({ ...prev, [group.key]: e.target.value }))}
                          aria-label={`Price for the ${n} classes at ${title}`}
                          className="w-full border rounded pl-5 pr-2 py-1 text-sm"
                          style={{
                            borderColor:
                              draft !== undefined && draft.trim() !== '' && parsed === null
                                ? 'var(--error-border)'
                                : COLORS.border,
                          }}
                        />
                      </div>
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => void applyGroup(group)}
                          disabled={saving !== null}
                          className="text-xs px-2.5 py-1.5 rounded font-medium text-white disabled:opacity-50"
                          style={{ backgroundColor: COLORS.accent }}
                        >
                          {saving === group.key ? 'Saving…' : `Set ${n} class${n === 1 ? '' : 'es'}`}
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen((prev) => ({ ...prev, [group.key]: !isOpen }))}
                    className="text-xs hover:underline"
                    style={{ color: COLORS.accent }}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Hide classes' : 'Show classes'}
                  </button>
                </div>

                {group.key === 'unpriced' && (
                  <p className="text-xs rounded px-2 py-1.5" style={{ backgroundColor: COLORS.warnSoft, color: COLORS.warn }}>
                    These classes cost nothing to enter right now. Give them a price, or tick Free on
                    the{' '}
                    <AutosaveNavLink href={entryFeesHref} className="underline">
                      Entry Fees page
                    </AutosaveNavLink>{' '}
                    if that is on purpose.
                  </p>
                )}

                {isOpen && (
                  <ul className="space-y-1 pl-1">
                    {group.classes.map((cls) => (
                      <ClassLine
                        key={cls.id}
                        cls={cls}
                        entryFeesHref={entryFeesHref}
                        draft={classDrafts[cls.id]}
                        onDraft={(value) => setClassDrafts((prev) => ({ ...prev, [cls.id]: value }))}
                        onSave={() => void applyClass(cls)}
                        saving={saving === cls.id}
                        busy={saving !== null}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(futurityCount > 0 || qualifyingCount > 0) && (
        <p className="text-xs" style={{ color: COLORS.muted }}>
          {futurityCount > 0 &&
            `${futurityCount} futurity class${futurityCount === 1 ? ' is' : 'es are'} priced by the futurity's categories (below). `}
          {qualifyingCount > 0 &&
            `${qualifyingCount} class${qualifyingCount === 1 ? ' is' : 'es are'} reached by qualifying, so nobody enters ${qualifyingCount === 1 ? 'it' : 'them'}.`}
        </p>
      )}
    </section>
  );
}

function ClassLine({
  cls,
  entryFeesHref,
  draft,
  onDraft,
  onSave,
  saving,
  busy,
}: {
  cls: ClassPriceRow;
  entryFeesHref: string;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  busy: boolean;
}) {
  const shown = draft ?? (cls.entry_fee_cents > 0 ? dollars(cls.entry_fee_cents) : '');
  const parsed = centsFrom(shown);
  const dirty = draft !== undefined && parsed !== null && parsed !== cls.entry_fee_cents;
  const number = hashNumber(cls.class_number);
  return (
    <li className="flex items-center gap-2 text-sm flex-wrap" style={{ color: COLORS.text }}>
      <span className="flex-1 min-w-[12rem]">
        {number && (
          <span className="font-mono text-xs mr-1.5" style={{ color: COLORS.accent }}>
            {number}
          </span>
        )}
        {cls.class_name}
        {cls.team_size ? (
          <span className="ml-1.5 text-xs" style={{ color: COLORS.muted }}>
            ({cls.team_size} riders)
          </span>
        ) : null}
        {(cls.sanctioning_codes ?? []).length > 0 && (
          <span className="ml-1.5 text-xs" style={{ color: COLORS.muted }}>
            {(cls.sanctioning_codes ?? []).join(', ')}
          </span>
        )}
      </span>
      {cls.is_free ? (
        <span className="text-xs" style={{ color: COLORS.muted }}>
          Free —{' '}
          <AutosaveNavLink href={entryFeesHref} className="underline">
            untick it on Entry Fees
          </AutosaveNavLink>{' '}
          to price it
        </span>
      ) : (
        <>
          <div className="relative w-20">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: COLORS.muted }}>
              $
            </span>
            <input
              inputMode="decimal"
              value={shown}
              placeholder="0.00"
              onChange={(e) => onDraft(e.target.value)}
              aria-label={`Entry fee for ${number || cls.class_name}`}
              className="w-full border rounded pl-5 pr-1.5 py-0.5 text-xs"
              style={{
                borderColor:
                  draft !== undefined && draft.trim() !== '' && parsed === null ? 'var(--error-border)' : COLORS.border,
              }}
            />
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || busy}
            className="text-xs px-2 py-0.5 rounded font-medium disabled:opacity-40"
            style={{ color: COLORS.accent }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </li>
  );
}
