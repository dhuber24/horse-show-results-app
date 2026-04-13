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

export async function fetchRider(riderId: string) {
  const res = await fetch(`${API_URL}/riders/${riderId}`);
  if (!res.ok) throw new Error('Failed to fetch rider');
  return res.json();
}
