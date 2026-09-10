/**
 * Which registries a horse's breeds imply, for prefilling the add-a-horse
 * wizard's Registrations step.
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
