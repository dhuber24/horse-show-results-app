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

export async function fetchResults(showId: string, classId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/classes/${classId}/results/`);
  if (!res.ok) throw new Error('Failed to fetch results');
  return res.json();
}

export async function fetchHorse(horseId: string) {
  const res = await fetch(`${API_URL}/horses/${horseId}`);
  if (!res.ok) throw new Error('Failed to fetch horse');
  return res.json();
}

export async function fetchExhibitor(exhibitorId: string) {
  const res = await fetch(`${API_URL}/exhibitors/${exhibitorId}`);
  if (!res.ok) throw new Error('Failed to fetch exhibitor');
  return res.json();
}

export async function fetchShow(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}`);
  if (!res.ok) throw new Error('Failed to fetch show');
  return res.json();
}

export async function fetchHorses() {
  const res = await fetch(`${API_URL}/horses/`);
  if (!res.ok) throw new Error('Failed to fetch horses');
  return res.json();
}

export async function fetchExhibitors() {
  const res = await fetch(`${API_URL}/exhibitors/`);
  if (!res.ok) throw new Error('Failed to fetch exhibitors');
  return res.json();
}

export async function fetchShowBackNumbers(showId: string) {
  const res = await fetch(`${API_URL}/shows/${showId}/back-numbers/`);
  if (!res.ok) return [];
  return res.json();
}

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

export async function fetchUsers() {
  const res = await fetch(`${API_URL}/users/`);
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}
