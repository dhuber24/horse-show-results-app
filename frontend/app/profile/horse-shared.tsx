'use client';

/**
 * Types and small presentational pieces shared by the My Horses list and the
 * Add a Horse wizard. Lives outside both so neither has to import the other.
 */

export interface Breed { id: string; name: string; }
export interface HorseColor { id: string; name: string; }

export type AssociationType = 'breed' | 'club';
export interface Association { id: string; code: string; name: string; association_type: AssociationType; }

/** A registration queued in the wizard but not yet written to the horse. */
export interface PendingReg {
  association_id: string;
  association_code: string;
  association_name: string;
  association_type: AssociationType;
  registration_number: string;
}

export interface HorseRegistrationBrief {
  association_id: string;
  association_code: string;
  association_type: AssociationType;
  registration_number: string;
}

export interface HorseDocumentBrief {
  document_type: string;
  document_type_label: string;
  issue_date: string | null;
  expiry_date: string | null;
}

export interface MyHorse {
  id: string;
  name: string;
  sex: string | null;
  age: number | null;
  breed_name: string | null;
  breed_names?: string[];
  color_name: string | null;
  is_solid_paint_bred: boolean;
  owner_exhibitor_id: string | null;
  owner_exhibitor_name?: string | null;
  owner_name?: string | null;
  trainer_name?: string | null;
  sire_name?: string | null;
  dam_name?: string | null;
  created_by_exhibitor_id: string | null;
  created_at?: string;
  registrations?: HorseRegistrationBrief[];
  documents?: HorseDocumentBrief[];
}

/** Result of an exact association + registration-number lookup. */
export interface LookupMatch {
  horse_id: string;
  horse_name: string;
  owner_name: string | null;
}

/** Result of the fuzzy name / registration-number search. */
export interface SearchMatch {
  horse_id: string;
  horse_name: string;
  owner_name: string | null;
  sex: string | null;
  breed_name: string | null;
  registrations: HorseRegistrationBrief[];
}

/** Breed registries and club memberships are different things, so they read
 *  differently: breed numbers are the horse's identity, club numbers are opt-in. */
export const REG_CHIP_STYLES: Record<AssociationType, { backgroundColor: string; color: string }> = {
  breed: { backgroundColor: '#f0e8d8', color: '#8b4513' },
  club: { backgroundColor: '#e0e7ff', color: '#3730a3' },
};

export function RegChips({ registrations }: { registrations: HorseRegistrationBrief[] }) {
  if (!registrations.length) return null;
  // Breed first — it's the horse's primary identity at a show.
  const ordered = [...registrations].sort((a, b) =>
    a.association_type === b.association_type ? 0 : a.association_type === 'breed' ? -1 : 1
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((r) => (
        <span
          key={r.association_id}
          className="text-xs px-1.5 py-0.5 rounded"
          style={REG_CHIP_STYLES[r.association_type] ?? REG_CHIP_STYLES.breed}
          title={r.association_type === 'club' ? 'Club membership' : 'Breed registration'}
        >
          <span className="font-mono font-semibold">{r.association_code}</span>{' '}
          <span className="font-mono">{r.registration_number}</span>
        </span>
      ))}
    </div>
  );
}

/** Shared by the standalone "find a horse" panel and the wizard's owner step. */
export function SearchResultList({
  results,
  existingIds,
  onSelect,
  busyId,
  actionLabel,
}: {
  results: SearchMatch[];
  existingIds: Set<string>;
  onSelect: (horseId: string) => void;
  busyId: string | null;
  actionLabel: string;
}) {
  return (
    <ul className="divide-y rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#ffffff' }}>
      {results.map((match) => {
        const alreadyOnProfile = existingIds.has(match.horse_id);
        const detail = [match.sex, match.breed_name, match.owner_name && `owner: ${match.owner_name}`]
          .filter(Boolean) as string[];
        return (
          <li key={match.horse_id} className="flex flex-wrap items-center justify-between gap-2 p-3" style={{ borderColor: '#f0e4d0' }}>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: '#2c1810' }}>{match.horse_name}</p>
              {detail.length > 0 && (
                <p className="text-xs" style={{ color: '#8b7355' }}>{detail.join(' · ')}</p>
              )}
              <div className="mt-1"><RegChips registrations={match.registrations} /></div>
            </div>
            {alreadyOnProfile ? (
              <span className="text-xs shrink-0" style={{ color: '#8b7355' }}>Already on your profile</span>
            ) : (
              <button
                onClick={() => onSelect(match.horse_id)}
                disabled={busyId !== null}
                className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 shrink-0"
                style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
              >
                {busyId === match.horse_id ? 'Adding...' : actionLabel}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
