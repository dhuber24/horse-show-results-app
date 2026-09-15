'use client';

import type { AssociationOption, AssociationType } from '@/components/AssociationSelect';

/** Matches the headings `AssociationSelect` puts on its optgroups — the same
 *  split, drawn as a list because this one is multi-select and each row can
 *  carry a number. */
const GROUP_LABELS: Record<AssociationType, string> = {
  breed: 'Breed registries',
  club: 'Clubs',
};

const GROUP_HINTS: Record<AssociationType, string> = {
  breed: 'The registries you hold show management certification with.',
  club: 'Clubs you are approved to run shows for.',
};

export interface CertEntry {
  association_id: string;
  secretary_id_number: string;
}

/**
 * Which bodies this person is carded with — breed registries and clubs in one
 * list, each with an optional identifier.
 *
 * **Nothing here is checked against anything.** The app holds no standing with
 * APHA or anyone else; it cannot tell a real certification number from a typo,
 * and a signup screen that turns somebody away over one it cannot verify is
 * worse than no question at all. This replaces a panel that looked up APHA
 * certification by email and — on the secretary screen — refused to submit
 * without it, which made APHA the only association a show could be run under.
 */
export default function CertificationPicker({
  associations,
  value,
  onChange,
  disabled = false,
}: {
  associations: AssociationOption[];
  value: Record<string, CertEntry>;
  onChange: (next: Record<string, CertEntry>) => void;
  disabled?: boolean;
}) {
  const toggle = (assoc: AssociationOption) => {
    const next = { ...value };
    if (next[assoc.id]) delete next[assoc.id];
    else next[assoc.id] = { association_id: assoc.id, secretary_id_number: '' };
    onChange(next);
  };

  const setNumber = (associationId: string, secretary_id_number: string) => {
    onChange({
      ...value,
      [associationId]: { ...value[associationId], secretary_id_number },
    });
  };

  const groups = (['breed', 'club'] as AssociationType[])
    .map((kind) => ({ kind, items: associations.filter((a) => a.association_type === kind) }))
    .filter((g) => g.items.length > 0);

  if (associations.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No associations are set up yet. You can add your certifications later from your profile.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(({ kind, items }) => (
        <div key={kind}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            {GROUP_LABELS[kind]}
          </h3>
          <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
            {GROUP_HINTS[kind]}
          </p>
          <div className="space-y-1.5">
            {items.map((assoc) => {
              const checked = !!value[assoc.id];
              return (
                <div
                  key={assoc.id}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: checked ? 'var(--accent)' : 'var(--border)',
                    backgroundColor: checked ? 'var(--bg-subtle)' : 'var(--surface)',
                  }}
                >
                  <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(assoc)}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span style={{ color: 'var(--foreground)' }}>
                      <span className="font-medium">{assoc.code}</span>
                      <span style={{ color: 'var(--muted)' }}> — {assoc.name}</span>
                    </span>
                  </label>
                  {checked && (
                    <div className="mt-2 pl-7">
                      <label
                        htmlFor={`cert-number-${assoc.id}`}
                        className="block text-xs mb-1"
                        style={{ color: 'var(--text-deep)' }}
                      >
                        {assoc.code} ID number{' '}
                        <span style={{ color: 'var(--muted)' }}>(optional)</span>
                      </label>
                      <input
                        id={`cert-number-${assoc.id}`}
                        value={value[assoc.id].secretary_id_number}
                        onChange={(e) => setNumber(assoc.id, e.target.value)}
                        disabled={disabled}
                        placeholder="If you have one to hand"
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{
                          borderColor: 'var(--border)',
                          backgroundColor: 'var(--surface)',
                          color: 'var(--foreground)',
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
