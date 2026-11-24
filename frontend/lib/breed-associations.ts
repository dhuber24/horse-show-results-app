/**
 * Which registries a horse's breeds imply, for prefilling the add-a-horse
 * wizard's Registrations step and for narrowing what a number may be filed
 * with.
 *
 * Somebody who has just ticked "American Paint Horse" on the Horse step should
 * not have to find APHA again in a dropdown of every association the app knows
 * two steps later — they have already said it.
 *
 * **Matched on the name, because there is no link to read.** `breeds` carries a
 * name and a sort order and nothing else; it has no `association_id`, and
 * adding one would mean a migration to encode a fact that is already legible in
 * the names ("American Paint Horse" / "American Paint Horse Association"). The
 * prefix test is deliberately strict — an association whose name *starts with*
 * the breed's — so "Appaloosa" reaches the Appaloosa Horse Club and nothing
 * reaches Foundation Quarter Horse Registry, which is a different registry for
 * the same breed and not something to guess at.
 *
 * **This is an affordance, never an inference that gets stored.** Nothing here
 * writes a registration: it preselects a picker the exhibitor can change, and
 * they still type the number themselves. That is the whole reason a name match
 * is acceptable at all — the repo's rule against guessing bites where a guess
 * would be filed and read back as fact, and a wrong prefill costs one click.
 *
 * Breed-type associations only. A club membership (NSBA, WSCA) is not implied
 * by what the horse *is*, so nothing here suggests one.
 *
 * **One rule is enforced from it** (`registrableAssociations`, at the show
 * office's request): a horse's forms offer a breed registry for its number only
 * when one of its ticked breeds is that registry's breed. Still nothing is
 * stored from the match — it narrows a picker.
 */

type NamedBreed = { id: string; name: string };
type NamedAssociation = {
  id: string;
  code: string;
  name: string;
  association_type?: 'breed' | 'club' | null;
};

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The breed registries implied by these breeds, in the order the associations
 * were given. Never returns a duplicate, and never returns a club.
 */
export function associationsForBreeds<T extends NamedAssociation>(
  breeds: NamedBreed[],
  associations: T[],
): T[] {
  const names = breeds.map((b) => normalise(b.name)).filter(Boolean);
  if (names.length === 0) return [];
  return associations.filter((a) => {
    if (a.association_type !== 'breed') return false;
    const assoc = normalise(a.name);
    return names.some((breed) => assoc.startsWith(breed));
  });
}

/**
 * The one registry to preselect next, given what is already queued.
 *
 * Null when the breeds imply nothing, or when every implied registry already
 * has a number against it — at which point preselecting anything would be
 * putting an association the exhibitor did not ask for into an empty box.
 */
export function nextSuggestedAssociation<T extends NamedAssociation>(
  breeds: NamedBreed[],
  associations: T[],
  alreadyUsedIds: Iterable<string>,
): T | null {
  const used = new Set(alreadyUsedIds);
  return associationsForBreeds(breeds, associations).find((a) => !used.has(a.id)) ?? null;
}

/**
 * Breed registries whose names do not start with the breed they register.
 * Keyed by association code, listing the breeds (by name) each registers. Not
 * consulted for suggestions — `nextSuggestedAssociation` stays strict, since a
 * second registry for the same breed is not something to guess at — only for
 * what may be chosen, where leaving FQHR out would make a Foundation Quarter
 * Horse number impossible to record.
 */
const ALSO_REGISTERS: Record<string, string[]> = {
  FQHR: ['american quarter horse'],
};

/**
 * The associations a horse with these breeds may hold a registration number
 * with: each breed registry one of its breeds names (and `ALSO_REGISTERS`),
 * and every club, which is not about what the horse *is*. A breed registry for
 * a breed that is not ticked is left out — a number with a registry the horse
 * is not a breed of is a typo or the wrong horse, and the paperwork check would
 * go on to verify it.
 *
 * Unlike the suggestion above this one is a rule the forms enforce, so with no
 * breed ticked no breed registry is offered at all.
 */
export function registrableAssociations<T extends NamedAssociation>(
  breeds: NamedBreed[],
  associations: T[],
): T[] {
  const implied = new Set(associationsForBreeds(breeds, associations).map((a) => a.id));
  const names = new Set(breeds.map((b) => normalise(b.name)));
  return associations.filter((a) => {
    if (a.association_type !== 'breed') return true;
    if (implied.has(a.id)) return true;
    return (ALSO_REGISTERS[a.code] ?? []).some((breed) => names.has(breed));
  });
}

/**
 * The registrations among `regs` whose registry the ticked breeds no longer
 * allow — a breed unticked after its number was added. The forms refuse to
 * save until each is removed or its breed ticked again.
 */
export function registrationsWithoutBreed<R extends { association_id: string }, T extends NamedAssociation>(
  regs: R[],
  breeds: NamedBreed[],
  associations: T[],
): R[] {
  const allowed = new Set(registrableAssociations(breeds, associations).map((a) => a.id));
  return regs.filter((r) => {
    const association = associations.find((a) => a.id === r.association_id);
    // An association this screen does not know about is left alone.
    return association !== undefined && !allowed.has(association.id);
  });
}
