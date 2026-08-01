'use client';

export type AssociationType = 'breed' | 'club';

export interface AssociationOption {
  id: string;
  code: string;
  name: string;
  association_type: AssociationType;
}

const GROUP_LABELS: Record<AssociationType, string> = {
  breed: 'Breed Registries',
  club: 'Clubs',
};

/**
 * Association picker that keeps breed registries and club bodies visually
 * separate. Breed registries identify the horse (AQHA, APHA); clubs are opt-in
 * memberships (NSBA, WSCA). Rendered as <optgroup>s so a single compact select
 * still communicates the split.
 */
export default function AssociationSelect({
  associations,
  value,
  onChange,
  placeholder = 'Select...',
  className = 'w-full border rounded px-3 py-2 text-sm',
  id,
}: {
  associations: AssociationOption[];
  value: string;
  onChange: (associationId: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const groups = (['breed', 'club'] as AssociationType[])
    .map((kind) => ({ kind, items: associations.filter((a) => a.association_type === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {groups.map(({ kind, items }) => (
        <optgroup key={kind} label={GROUP_LABELS[kind]}>
          {items.map((a) => (
            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Small inline marker so a registration row reads as breed vs club at a glance. */
export function AssociationTypeBadge({ type }: { type: AssociationType }) {
  const style = type === 'club'
    ? { backgroundColor: '#e0e7ff', color: '#3730a3' }
    : { backgroundColor: '#f0e8d8', color: '#8b4513' };
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={style}>
      {type === 'club' ? 'Club' : 'Breed'}
    </span>
  );
}
