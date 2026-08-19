const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';

export async function fetchShows() {
  const res = await fetch(`${API_URL}/shows/`);
  if (!res.ok) throw new Error('Failed to fetch shows');
  return res.json();
}

export async function fetchClasses(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/classes/`);
  if (!res.ok) throw new Error('Failed to fetch classes');
  return res.json();
}

export async function fetchEntries(showId: string, classId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/entries/`);
  if (!res.ok) throw new Error('Failed to fetch entries');
  return res.json();
}

/**
 * Placings for a class.
 *
 * Pass `headers` (from `getAuthHeaders()`) when the caller is show staff — the
 * backend returns an empty list for a class whose results have not been posted
 * yet, so the scribe's own entry form must identify itself or it will render a
 * blank card over a draft it is halfway through typing.
 */
export async function fetchResults(showId: string, classId: string, headers?: HeadersInit) {
  const res = await fetch(
    `${API_URL}/shows/${showId}/classes/${classId}/results/`,
    headers ? { headers, cache: 'no-store' } : {},
  );
  if (!res.ok) throw new Error('Failed to fetch results');
  return res.json();
}

/**
 * The show's judging panel, names only — no auth required.
 *
 * Placings are recorded per judge, so both the scribe screen and the public
 * class page need the panel to label the cards. Contact details stay behind
 * the staff endpoint; this returns what the show bill already prints.
 */
export async function fetchShowJudgesPublic(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/judges/public`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

/**
 * The show's fee schedule — stalls, shavings, camping, late fees — no auth.
 *
 * What the show bill prints. Returns [] rather than throwing: a showbill with
 * no price list is still a usable showbill, and a fee lookup should not be able
 * to take the class schedule down with it.
 */
export async function fetchShowFeesPublic(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/fees/public`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchResultsIndex(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/results-index`);
  if (!res.ok) return {} as Record<string, unknown[]>;
  return res.json();
}

export async function fetchProgramIndex(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/program-index`);
  if (!res.ok) return {} as Record<string, unknown[]>;
  return res.json();
}

export async function fetchHorse(horseId: string, headers?: HeadersInit) {
  const res = await fetch(`${API_URL}/horses/${horseId}`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch horse');
  return res.json();
}

export async function fetchExhibitor(exhibitorId: string, headers?: HeadersInit) {
  const res = await fetch(`${API_URL}/exhibitors/${exhibitorId}`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch exhibitor');
  return res.json();
}

export async function fetchShow(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}`);
  if (!res.ok) throw new Error('Failed to fetch show');
  return res.json();
}

export async function fetchHorses(headers?: HeadersInit) {
  const res = await fetch(`${API_URL}/horses/`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch horses');
  return res.json();
}

export async function fetchExhibitors(
  headers?: HeadersInit,
  opts?: { withUser?: boolean },
) {
  const qs = opts?.withUser ? '?with_user=true' : '';
  const res = await fetch(`${API_URL}/exhibitors/${qs}`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch exhibitors');
  return res.json();
}

// fetchShowBackNumbers() was removed: it called the staff-only
// /shows/{id}/back-numbers/ endpoint with no auth headers from public pages,
// so it always 422'd and silently returned []. Back numbers now come resolved
// off the entries and program-index endpoints — see backend/backnumbers.py.

export async function fetchExhibitorHorses(exhibitorId: string) {
  const res = await fetch(`${API_URL}/exhibitors/${exhibitorId}/horses`);
  if (!res.ok) throw new Error('Failed to fetch exhibitor horses');
  return res.json();
}

export async function fetchVenues() {
  const res = await fetch(`${API_URL}/venues/`);
  if (!res.ok) throw new Error('Failed to fetch venues');
  return res.json();
}

export async function fetchVenue(venueId: string) {
  const res = await fetch(`${API_URL}/venues/${venueId}`);
  if (!res.ok) throw new Error('Failed to fetch venue');
  return res.json();
}

export async function fetchShowTypes() {
  const res = await fetch(`${API_URL}/show-types/`);
  if (!res.ok) throw new Error('Failed to fetch show types');
  return res.json();
}

/**
 * The registry of bodies a horse or person can be affiliated with (breed
 * registries and club bodies). Distinct from show types, which are show
 * configuration. Pass `type` to fetch only 'breed' or only 'club'.
 */
export async function fetchAssociations(
  headers?: HeadersInit,
  type?: 'breed' | 'club',
) {
  const qs = type ? `?type=${type}` : '';
  const res = await fetch(`${API_URL}/associations/${qs}`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch associations');
  return res.json();
}

export async function fetchShowType(id: string) {
  const res = await fetch(`${API_URL}/show-types/${id}`);
  if (!res.ok) throw new Error('Failed to fetch show type');
  return res.json();
}

export async function fetchUsers(headers?: HeadersInit) {
  const res = await fetch(`${API_URL}/users/`, headers ? { headers } : {});
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function fetchBreeds() {
  const res = await fetch(`${API_URL}/breeds/`);
  if (!res.ok) throw new Error('Failed to fetch breeds');
  return res.json();
}

export async function fetchTrainers(headers?: HeadersInit) {
  const res = await fetch(`${API_URL}/trainers/`, headers ? { headers } : {});
  if (!res.ok) return [];
  return res.json();
}

export async function fetchBreed(id: string) {
  const res = await fetch(`${API_URL}/breeds/${id}`);
  if (!res.ok) throw new Error('Failed to fetch breed');
  return res.json();
}

export async function fetchHorseColors() {
  const res = await fetch(`${API_URL}/horse-colors/`);
  if (!res.ok) throw new Error('Failed to fetch horse colors');
  return res.json();
}

export async function fetchHorseColor(id: string) {
  const res = await fetch(`${API_URL}/horse-colors/${id}`);
  if (!res.ok) throw new Error('Failed to fetch horse color');
  return res.json();
}

export async function fetchExhibitorByUser(userId: string) {
  const res = await fetch(`${API_URL}/exhibitors/by-user/${userId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch exhibitor');
  return res.json();
}

export async function fetchHorseRegistrations(horseId: string) {
  const res = await fetch(`${API_URL}/horses/${horseId}/registrations`);
  if (!res.ok) throw new Error('Failed to fetch horse registrations');
  return res.json();
}

export async function fetchRings(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/rings/`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDisciplines(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/disciplines/`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDivisions(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/divisions/`);
  if (!res.ok) return [];
  return res.json();
}

/**
 * Where the signed-in caller stands at one show — signed up, back number,
 * classes entered.
 *
 * Falls back to "no standing" rather than throwing. This decorates the show
 * page; a hiccup here should change the banner, never blank the page the
 * classes are on.
 */
export async function fetchMyShowStanding(showId: string, headers?: HeadersInit) {
  try {
    // Explicitly uncached. The entire point of this call is that the banner
    // changes the moment someone signs up — serving it from the data cache
    // would put "Registration is open, sign up" back in front of a person who
    // just did, which is the bug it exists to fix.
    const res = await fetch(`${API_URL}/my-shows/${showId}`, {
      cache: 'no-store',
      ...(headers ? { headers } : {}),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchStandardDisciplines(showTypeId?: string) {
  const url = showTypeId
    ? `${API_URL}/standard-setup/disciplines?show_type_id=${encodeURIComponent(showTypeId)}`
    : `${API_URL}/standard-setup/disciplines`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchStandardDivisions(showTypeId?: string) {
  const url = showTypeId
    ? `${API_URL}/standard-setup/divisions?show_type_id=${encodeURIComponent(showTypeId)}`
    : `${API_URL}/standard-setup/divisions`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}
