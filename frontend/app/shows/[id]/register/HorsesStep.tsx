'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RELATIONSHIP_OPTION_GROUPS } from '@/lib/apha';
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
 * Adding a horse is still a link. That flow runs the document-extraction
 * wizard, and a second copy of it here would be a second copy to keep in step.
 */

const RELATIONSHIP_HELP =
  'APHA asks this on Amateur and Youth entries (AM-300.E, YP-015). You do not own ' +
  'this horse, so it is the one thing about it the app cannot work out. Answered ' +
  'once here and used on every class you enter.';

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
    <li className="rounded-lg border p-3" style={{ borderColor: '#e8d5b7', backgroundColor: '#fffdf9' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium" style={{ color: '#2c1810' }}>
          {horse.name}
          {horse.is_solid_paint_bred && (
            <span className="text-xs ml-1.5" style={{ color: '#8b7355' }}>
              (SPB)
            </span>
          )}
        </span>
        <span className="text-xs" style={{ color: '#8b7355' }}>
          {(horse.registrations ?? []).length > 0
            ? `Registered: ${(horse.registrations ?? []).join(', ')}`
            : 'No registration numbers on file'}
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
          style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}
        >
          <span>
            <strong>
              No {flags.map((f) => f.association_code).join(', ')} registration{' '}
              {flags.length === 1 ? 'number' : 'numbers'} on file.
            </strong>{' '}
            This show runs under {flags.length === 1 ? 'it' : 'them'} and asks for papers at the
            desk — you can still enter.
          </span>
          <Link
            href={`/profile/horses/${horse.id}`}
            className="shrink-0 font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            {flags.length === 1 ? 'Add the number →' : 'Add the numbers →'}
          </Link>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          className="mt-2 rounded border p-2 text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}
        >
          <span>{warnings.join(' ')}</span>
          <Link
            href={`/profile/horses/${horse.id}`}
            className="shrink-0 font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Upload documents →
          </Link>
        </div>
      )}

      {/* Nothing to ask: the horse is theirs, so the answer is on the horse's
          own record. Stated rather than hidden, because it goes onto every
          entry and an exhibitor should be able to see what was filed for them. */}
      {needsRelationship && horse.owns_horse && (
        <p className="text-xs mt-2" style={{ color: '#5d4a37' }}>
          Shown as <strong>Self</strong>
          <span style={{ color: '#8b7355' }}>
            {' '}— you are the recorded owner, so APHA&apos;s ownership question answers itself
            (AM-300.E, YP-015).
          </span>
        </p>
      )}

      {needsRelationship && !horse.owns_horse && (
        <label className="block mt-2">
          <span className="block text-xs mb-1" style={{ color: '#5d4a37' }}>
            Your relationship to {horse.owner_name ? `${horse.owner_name}, ` : ''}this horse&apos;s
            owner
          </span>
          <select
            value={relationship}
            onChange={(e) => save(e.target.value)}
            disabled={saving}
            title={RELATIONSHIP_HELP}
            className="w-full sm:w-auto border rounded px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: relationship ? '#d4b896' : '#c9a227' }}
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
          <span className="block text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {saving ? 'Saving…' : RELATIONSHIP_HELP}
          </span>
        </label>
      )}

      {error && (
        <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      )}
    </li>
  );
}

export default function HorsesStep({
  showId,
  horses,
  needsRelationship,
  showTypeCode,
}: {
  showId: string;
  horses: PreviewHorse[];
  needsRelationship: boolean;
  /** Only for the wording — which body's papers this show is asking about. */
  showTypeCode: string | null;
}) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: '#5d4a37' }}>
        You enter classes on a horse from your profile. Everything flagged below can be sorted out
        before you ship in — none of it stops you entering.
      </p>

      {horses.length === 0 ? (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
        >
          You don&apos;t have any horses on your profile yet. Add one to carry on — your stall and
          camping numbers can be set either way.
          <div className="mt-2">
            <Link
              href="/profile/horses/new"
              className="font-medium hover:underline"
              style={{ color: '#8b4513' }}
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

      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
        <span className="text-xs" style={{ color: '#8b7355' }}>
          {showTypeCode && showTypeCode !== 'OPEN'
            ? `${showTypeCode} shows ask for the horse's registration number at the desk.`
            : 'This show has no breed requirement of its own.'}
        </span>
        {horses.length > 0 && (
          <Link
            href="/profile/horses/new"
            className="text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Add another horse →
          </Link>
        )}
      </div>
    </div>
  );
}
