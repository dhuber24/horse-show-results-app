'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { type AssociationOption, type LookupOption } from './StaffAddHorseForm';
import { COLORS } from './types';

interface ExhibitorName {
  id: string;
  full_name: string;
  has_account: boolean;
  /** Typed in by show staff rather than created by somebody signing up. */
  office_record: boolean;
}

/**
 * Putting somebody on this show's roster — whether or not the app has heard of
 * them.
 *
 * It used to offer only exhibitors with a linked user account, and told staff
 * that anybody else needed one before they could be entered: "an admin creates
 * one from Users." That is not something a secretary can do for a person
 * standing at the counter holding a paper entry blank, and it is not something
 * that person wants to stop and do either. So the second half of this form
 * creates the record itself — a name is enough — and the account stays their
 * business, later or never.
 *
 * Three things follow from that and are deliberate.
 *
 * The search now includes records **the office typed in** (`office_record`),
 * because the whole point of one is that it outlives the weekend: somebody
 * entered by hand in April is found by name in August rather than typed in
 * again. What stays excluded is an accountless record nobody claims — seed
 * data, or the leftover of a deleted account.
 *
 * Every row says whether it has an account behind it, since the list can now
 * legitimately show the same name twice and staff have to be able to tell which
 * is which. (Two records of one person is what the panel's Merge control is
 * for; two people of one name is a real thing and neither screen guesses.)
 *
 * The horse is offered **after** the person exists, not as more boxes on the
 * same form. Most walk-ups already have theirs on file, the entry form is where
 * that is found out, and a second form's worth of optional fields between a
 * name and a back number is how a queue builds up. Offered as a choice here and
 * *answered in the panel*, because this form sits in the roster column and the
 * horse form was written for the panel — see the comment on `created` below.
 */
export default function AddExhibitorForm({
  showId,
  onRosterIds,
  associations,
  breeds,
  colors,
  patterns,
  onAdded,
  onCancel,
}: {
  showId: string;
  /** Who is already at this show, so the picker does not offer them again. */
  onRosterIds: Set<string>;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
  patterns: LookupOption[];
  /** `addHorse` asks the caller to open that person's panel with the
   *  add-a-horse form already open, which is where it has room to render. */
  onAdded: (exhibitorId: string, opts?: { addHorse?: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [people, setPeople] = useState<ExhibitorName[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** `null` while searching; the form once staff choose to type somebody in. */
  const [draft, setDraft] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  } | null>(null);

  /** Set once the record exists, which is what turns the horse form on. */
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    // `dedupe=false`: the owner pickers want one row per person, but a desk
    // looking at somebody who is on the app twice has to see both records.
    fetch('/api/exhibitors/names?dedupe=false')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load the exhibitor list.'))
      .finally(() => setLoading(false));
  }, []);

  const matches = useMemo(() => {
    const available = people.filter((p) => !onRosterIds.has(p.id));
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 12);
    return available.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 12);
  }, [people, onRosterIds, query]);

  const add = async (exhibitorId: string) => {
    setSaving(exhibitorId);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/desk/exhibitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exhibitor_id: exhibitorId }),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(errorMessage(body, 'Could not add them to this show.'));
      return;
    }
    await onAdded(exhibitorId);
  };

  /** Split whatever is in the search box, so a typed name is not typed twice. */
  const startDraft = () => {
    const [first, ...rest] = query.trim().split(/\s+/);
    setDraft({
      first_name: first ?? '',
      last_name: rest.join(' '),
      email: '',
      phone: '',
    });
    setError(null);
  };

  const create = async () => {
    if (!draft) return;
    setSaving('new');
    setError(null);
    const res = await fetch(`/api/shows/${showId}/desk/exhibitors/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
      }),
    });
    setSaving(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(errorMessage(body, 'Could not create that exhibitor.'));
      return;
    }
    // On the roster with a back number already. The horse is the optional
    // extra, and closing here without one is a finished job.
    setCreated({ id: body.exhibitor_id, name: body.exhibitor_name });
  };

  const canCreate = Boolean(draft?.first_name.trim() && draft?.last_name.trim());

  // ── Created: offer the horse, or leave it ───────────────────────────────────
  //
  // The horse form itself is **not** rendered here. This form lives in the
  // roster column, which is a third of the width of the panel the horse form
  // was written for — its two-column field grid and its association row both
  // spill out of a card this narrow, and Tailwind's breakpoints are viewport
  // widths, so no `sm:` can tell the two containers apart. Choosing here and
  // opening the form in the panel puts it where there is room for it.
  if (created) {
    return (
      <div
        className="rounded-lg border p-3 space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            {created.name} is on the roster
          </h3>
          <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
            They have a back number already. Do they have a horse to enter that is not on file?
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onAdded(created.id, { addHorse: true })}
            className="px-3 py-1.5 rounded text-sm font-medium text-white"
            style={{ backgroundColor: COLORS.accent }}
          >
            Add a horse
          </button>
          <button
            type="button"
            onClick={() => onAdded(created.id)}
            className="px-3 py-1.5 rounded border text-sm font-medium hover:bg-amber-50 transition-colors"
            style={{ borderColor: COLORS.border, color: COLORS.accent }}
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  // ── Typing somebody in ──────────────────────────────────────────────────────
  if (draft) {
    return (
      <div
        className="rounded-lg border p-3 space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
            New exhibitor
          </h3>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-xs hover:underline"
            style={{ color: COLORS.muted }}
          >
            Back to search
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs" style={{ color: COLORS.muted }}>
            First name
            <input
              autoFocus
              value={draft.first_name}
              onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ borderColor: COLORS.border, color: COLORS.text }}
            />
          </label>
          <label className="text-xs" style={{ color: COLORS.muted }}>
            Last name
            <input
              value={draft.last_name}
              onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ borderColor: COLORS.border, color: COLORS.text }}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs" style={{ color: COLORS.muted }}>
            Email <span style={{ color: COLORS.muted }}>(optional)</span>
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              /* The one optional field that does work later: if they open an
                 account with this address, the desk can point at this record
                 instead of leaving staff to find it among everyone of the
                 same name. */
              title="If they sign up later with this address, the desk will offer to join the two records."
              className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ borderColor: COLORS.border, color: COLORS.text }}
            />
          </label>
          <label className="text-xs" style={{ color: COLORS.muted }}>
            Phone <span style={{ color: COLORS.muted }}>(optional)</span>
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ borderColor: COLORS.border, color: COLORS.text }}
            />
          </label>
        </div>

        {error && (
          <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={create}
            disabled={!canCreate || saving === 'new'}
            title={canCreate ? undefined : 'A first and last name are both needed.'}
            className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: COLORS.accent }}
          >
            {saving === 'new' ? 'Creating…' : 'Create & add to show'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs hover:underline"
            style={{ color: COLORS.muted }}
          >
            Cancel
          </button>
        </div>

        <p className="text-xs" style={{ color: COLORS.muted }}>
          This makes the show&rsquo;s own record of them — no login, and nothing is emailed. If
          they open an account later, their entries can be joined to it.
        </p>
      </div>
    );
  }

  // ── Searching ───────────────────────────────────────────────────────────────
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: COLORS.border, backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
          Add someone to this show
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs hover:underline"
          style={{ color: COLORS.muted }}
        >
          Cancel
        </button>
      </div>

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={loading ? 'Loading exhibitors…' : 'Type a name…'}
        disabled={loading}
        className="w-full border rounded px-3 py-2 text-sm disabled:opacity-50"
        style={{ borderColor: COLORS.border, color: COLORS.text }}
      />

      {error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      {!loading && matches.length === 0 && (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          {query.trim()
            ? 'Nobody on file matches that name.'
            : 'Everybody on file is already on this show’s roster.'}
        </p>
      )}

      <ul className="space-y-1">
        {matches.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => add(person.id)}
              disabled={saving !== null}
              className="w-full text-left px-3 py-2 rounded border text-sm hover:bg-amber-50 transition-colors disabled:opacity-50"
              style={{ borderColor: COLORS.borderSoft, color: COLORS.text }}
            >
              {saving === person.id ? `Adding ${person.full_name}…` : person.full_name}
              {/* The list can legitimately hold the same name twice now, so
                  each row says which record it is. */}
              {person.office_record && (
                <span className="ml-2 text-xs" style={{ color: COLORS.muted }}>
                  · added by the office
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={startDraft}
        className="w-full border-2 border-dashed rounded px-3 py-2 text-sm font-medium hover:bg-amber-50 transition-colors"
        style={{ borderColor: COLORS.border, color: COLORS.accent }}
      >
        {query.trim() ? `+ Create “${query.trim()}” as a new exhibitor` : '+ Create a new exhibitor'}
      </button>
    </div>
  );
}
