'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RELATIONSHIP_OPTION_GROUPS } from '@/lib/apha';
import { errorMessage } from '@/lib/api-error';
import { healthWarnings, type PreviewHorse } from './types';

/**
 * Step two: the horses, and what this show will want to know about them.
 *
 * Splitting the horses out of the profile step is not tidying. Three separate
 * questions attach to a horse and none of them belongs on a form about the
 * person:
 *
 * 1. **Is it registered with the body running this show?** An exhibitor could
 *    enter an APHA show on a horse with no APHA number on file and hear nothing
 *    about it until the desk asked for papers. Warned about here, at the moment
 *    the horse is being chosen — never refused, because refusing the entry
 *    would not register the horse and a number can be typed in from the phone
 *    in somebody's hand.
 * 2. **How is this exhibitor entitled to show it?** APHA AM-300.E and YP-015
 *    want the relationship to the owner on every Amateur and Youth entry —
 *    and most of the time there is nothing to ask, because the exhibitor owns
 *    the horse and `horses.owner_exhibitor_id` already says so. Those read
 *    "Self", stated rather than offered as a choice.
 *
 *    The picker appears only for a horse **somebody else owns**, where no
 *    record anywhere says whether that person is your mother, your aunt or
 *    your neighbour — the profile holds contact details and a guardian's name,
 *    not a family tree. Even then it is asked once here and copied onto every
 *    entry, rather than per class from a list of twenty-five, which is how
 *    entering eight classes on one horse used to mean answering the same
 *    question eight times.
 * 3. **Is its health paperwork going to carry it through the show?** Already
 *    computed for the office; shown here so the exhibitor sees the same list
 *    with time to do something about it.
 *
 * **The list is this show's, not the profile's** (migration 145). It opens
 * on the horses on the profile, and removing one, putting one back or
 * answering the relationship changes this registration only. Removing a horse
 * here used to take it off the profile too.
 *
 * Adding a *new* horse is still a link, and the one door that reaches the
 * profile: the wizard runs document extraction, a second copy of it here would
 * be a second copy to keep in step, and a horse created for one show is one
 * the exhibitor will bring to the next.
 */

/** A refusal from these endpoints carries `{ code, message }` in `detail`,
 *  which `errorMessage` does not read. */
function failure(json: unknown, fallback: string): string {
  const detail = (json as { detail?: { message?: unknown } } | null)?.detail;
  return typeof detail?.message === 'string' ? detail.message : errorMessage(json, fallback);
}

const RELATIONSHIP_HELP =
  'APHA asks this on Amateur and Youth entries (AM-300.E, YP-015). You do not own ' +
  'this horse, so it is the one thing about it the app cannot work out. Answered ' +
  'once here and used on every class you enter.';

/** The same thing in the space a phone actually has. The rule citation stays on
 *  the select's `title`, where it costs nobody a line. */
const RELATIONSHIP_HINT = 'Asked once — used on every class.';

/**
 * Take a horse off this show's registration — never off the profile.
 *
 * This used to be the profile's own removal (clearing the creator, or dropping
 * the rider link), so a horse taken off one show's registration vanished from
 * the profile and from every other show's picker. It is this show's list now
 * (migration 145): the horse stays on the profile, and it can be put back from
 * the "On your profile" list below.
 *
 * Refused while the horse is entered in a class at this show, by the endpoint
 * and again here so the button never looks available — a horse removed out
 * from under its own entries leaves the exhibitor billed for classes they can
 * no longer withdraw from.
 *
 * Inline confirmation rather than a straight click, matching the class table
 * above it: this is the exhibitor's own phone, and a mis-tap that quietly
 * unpicks a horse is not something anybody notices until the gate.
 */
function RemoveHorse({
  showId,
  horse,
  onRemoved,
}: {
  showId: string;
  horse: PreviewHorse;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enteredCount = horse.entered_class_count ?? 0;

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/horses/${horse.id}`, {
        method: 'DELETE',
      });
      if (res.status !== 204 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(failure(json, 'Could not remove that horse.'));
        setRemoving(false);
        return;
      }
      setRemoving(false);
      setConfirming(false);
      onRemoved();
    } catch {
      setError('Network error — please try again.');
      setRemoving(false);
    }
  };

  if (enteredCount > 0) {
    return (
      <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
        In {enteredCount} class{enteredCount === 1 ? '' : 'es'} —{' '}
        <Link
          href={`#registration-classes`}
          className="font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          withdraw
        </Link>{' '}
        to remove
      </span>
    );
  }

  return (
    <span className="shrink-0 text-right">
      {confirming ? (
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--error)' }}
          >
            {removing ? 'Removing…' : 'Yes, remove'}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={removing}
            className="text-xs hover:underline disabled:opacity-50"
            style={{ color: 'var(--muted)' }}
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs hover:underline"
          style={{ color: 'var(--error)' }}
          title={`Take ${horse.name} off this show — it stays on your profile`}
        >
          Remove
        </button>
      )}
      {error && (
        <span className="block text-xs mt-1" style={{ color: 'var(--error)' }}>
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * Profile horses this registration no longer lists, each with a way back on.
 *
 * Only ever non-empty once the horses step has been changed for this show:
 * until then the registration *is* the profile's list, so there is nothing
 * missing from it to offer.
 */
function OtherProfileHorses({
  showId,
  horses,
  onAdded,
}: {
  showId: string;
  horses: { id: string; name: string }[];
  onAdded: () => void;
}) {
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (horseId: string) => {
    setAddingId(horseId);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/horses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horse_id: horseId }),
      });
      if (res.status !== 204 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(failure(json, 'Could not add that horse.'));
        setAddingId(null);
        return;
      }
      setAddingId(null);
      onAdded();
    } catch {
      setError('Network error — please try again.');
      setAddingId(null);
    }
  };

  if (horses.length === 0) return null;

  return (
    <div className="pt-1">
      <h4 className="text-xs font-semibold mb-1" style={{ color: 'var(--text-deep)' }}>
        On your profile, not at this show
      </h4>
      <ul className="space-y-1">
        {horses.map((horse) => (
          <li key={horse.id} className="flex items-center justify-between gap-2 text-sm">
            <span style={{ color: 'var(--foreground)' }}>{horse.name}</span>
            <button
              type="button"
              onClick={() => add(horse.id)}
              disabled={addingId !== null}
              className="text-xs font-medium hover:underline disabled:opacity-50"
              style={{ color: 'var(--accent)' }}
            >
              {addingId === horse.id ? 'Adding…' : 'Add to this show'}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function HorseCard({
  showId,
  horse,
  needsRelationship,
  onChanged,
}: {
  showId: string;
  horse: PreviewHorse;
  /** Only relevant at a show whose association cares. Everywhere else it is a
   *  field with no reader, and a form that asks for something nothing consumes
   *  is how people learn to skim past the ones that matter. Even here it only
   *  becomes a *question* for a horse the exhibitor does not own. */
  needsRelationship: boolean;
  onChanged: () => void;
}) {
  const [relationship, setRelationship] = useState(horse.relationship_to_owner ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flags = horse.registration_flags ?? [];
  const warnings = healthWarnings(horse);

  const save = async (value: string) => {
    setRelationship(value);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/register/horses/${horse.id}/relationship`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationship_to_owner: value || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(
          typeof json?.detail === 'string' ? json.detail : 'Could not save that relationship.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      onChanged();
    } catch {
      setError('Network error — please try again.');
      setSaving(false);
    }
  };

  return (
    <li className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium" style={{ color: 'var(--foreground)' }}>
          {horse.name}
          {horse.is_solid_paint_bred && (
            <span className="text-xs ml-1.5" style={{ color: 'var(--muted)' }}>
              (SPB)
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
          <span>
            {(horse.registrations ?? []).length > 0
              ? `Registered: ${(horse.registrations ?? []).join(', ')}`
              : 'No registration numbers on file'}
          </span>
          <RemoveHorse showId={showId} horse={horse} onRemoved={onChanged} />
        </span>
      </div>

      {/* The alert this step exists for — one line, however many bodies are
          short. A dual-sanctioned show produces a flag per association, and
          three boxes saying nearly the same thing about the same horse is how
          people learn to scroll past the panel. A warning with a destination,
          never a gate: the number goes on the horse's own record, and the desk
          verifies it against the papers either way. */}
      {flags.length > 0 && (
        <div
          className="mt-2 rounded border p-2 text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          <span>
            <strong>
              No {flags.map((f) => f.association_code).join(', ')} number
              {flags.length === 1 ? '' : 's'} on file.
            </strong>{' '}
            Papers are checked at the desk — you can still enter.
          </span>
          <Link
            href={`/profile/horses/${horse.id}`}
            className="shrink-0 font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            {flags.length === 1 ? 'Add the number →' : 'Add the numbers →'}
          </Link>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          className="mt-2 rounded border p-2 text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          <span>{warnings.join(' ')}</span>
          <Link
            href={`/profile/horses/${horse.id}`}
            className="shrink-0 font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Upload documents →
          </Link>
        </div>
      )}

      {/* Nothing to ask: the horse is theirs, so the answer is on the horse's
          own record. Stated rather than hidden, because it goes onto every
          entry and an exhibitor should be able to see what was filed for them. */}
      {needsRelationship && horse.owns_horse && (
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--text-deep)' }}
          title="APHA asks how you are entitled to show this horse (AM-300.E, YP-015). You are its recorded owner, so the answer is Self."
        >
          Shown as <strong>Self</strong>
          <span style={{ color: 'var(--muted)' }}> — you&apos;re the recorded owner.</span>
        </p>
      )}

      {needsRelationship && !horse.owns_horse && (
        <label className="block mt-2">
          <span className="block text-xs mb-1" style={{ color: 'var(--text-deep)' }}>
            Your relationship to {horse.owner_name ? `${horse.owner_name}, ` : ''}the owner
          </span>
          <select
            value={relationship}
            onChange={(e) => save(e.target.value)}
            disabled={saving}
            title={RELATIONSHIP_HELP}
            className="w-full sm:w-auto border rounded px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: relationship ? 'var(--border)' : 'var(--warning)' }}
          >
            <option value="">Not stated</option>
            {RELATIONSHIP_OPTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {saving ? 'Saving…' : RELATIONSHIP_HINT}
          </span>
        </label>
      )}

      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </li>
  );
}

export default function HorsesStep({
  showId,
  horses,
  otherProfileHorses = [],
  ownCopy = false,
  needsRelationship,
  showTypeCode,
}: {
  showId: string;
  /** The horses on this show's registration. */
  horses: PreviewHorse[];
  /** On the profile, taken off this registration — offered back. */
  otherProfileHorses?: { id: string; name: string }[];
  /** True once this show holds its own horse list rather than the profile's. */
  ownCopy?: boolean;
  needsRelationship: boolean;
  /** Only for the wording — which body's papers this show is asking about. */
  showTypeCode: string | null;
}) {
  const router = useRouter();

  // Back to this step of this show's registration when the wizard is done.
  // Adding a horse is a five-step detour on another route, and returning
  // somebody to the top of their profile afterwards means finding the show
  // again and re-opening the step they were on. `safeNextPath` sanitises it at
  // the far end, because a `?next=` is a URL a stranger can compose. `show`
  // tells the wizard to put the new horse on this registration as well as the
  // profile — a registration that stopped following the profile would
  // otherwise not list the horse somebody just created for it.
  const addHorseHref =
    `/profile/horses/new?show=${encodeURIComponent(showId)}` +
    `&next=${encodeURIComponent(`/shows/${showId}/register?step=horses`)}`;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
        Nothing flagged below stops you entering — sort it before you ship in.
      </p>
      <p className="text-xs -mt-2" style={{ color: 'var(--muted)' }}>
        {ownCopy
          ? 'Changed for this show — your profile is unchanged.'
          : 'From your profile. Removing a horse here only takes it off this show.'}
      </p>

      {horses.length === 0 ? (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          {otherProfileHorses.length > 0
            ? 'No horses on this registration yet. Add one to carry on.'
            : 'No horses on your profile yet. Add one to carry on.'}
          <div className="mt-2">
            <Link
              href={addHorseHref}
              className="font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Add a horse →
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {horses.map((horse) => (
            <HorseCard
              key={horse.id}
              showId={showId}
              horse={horse}
              needsRelationship={needsRelationship}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}

      <OtherProfileHorses
        showId={showId}
        horses={otherProfileHorses}
        onAdded={() => router.refresh()}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {showTypeCode && showTypeCode !== 'OPEN'
            ? `${showTypeCode} shows ask for papers at the desk.`
            : 'No breed requirement at this show.'}
        </span>
        {horses.length > 0 && (
          <Link
            href={addHorseHref}
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Add another horse →
          </Link>
        )}
      </div>
    </div>
  );
}
