import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/**
 * The classes the signed-in exhibitor is entered in at one show.
 *
 * Read from the dashboard endpoint, which is already the exhibitor's own entry
 * list. Both callers — the class schedule's Registered filter and the Patterns
 * page's "for your classes" — are public spectator pages that must keep working
 * for everyone else, so a failure here degrades to "no classes" rather than
 * breaking the page. Server-only: it reads the session.
 */
export async function fetchRegisteredClassIds(showId: string, userId: string): Promise<string[]> {
  try {
    const headers = await getAuthHeaders();
    if (!headers) return [];
    const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.entries ?? [])
      .filter((e: { show_id: string }) => e.show_id === showId)
      .map((e: { class_id: string }) => e.class_id);
  } catch {
    return [];
  }
}
