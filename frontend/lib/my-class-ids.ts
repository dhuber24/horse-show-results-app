import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/** The signed-in exhibitor's own entries at one show: the classes they are in,
 *  and the entries themselves — the Results page's *My classes* filter needs
 *  the second to pick their placing out of a class. */
export type MyShowEntries = { classIds: string[]; entryIds: string[] };

/**
 * The signed-in exhibitor's entries at one show.
 *
 * Read from the dashboard endpoint, which is already the exhibitor's own entry
 * list. Every caller — the class schedule's Registered filter, the Patterns
 * page's "for your classes", and the *My classes* filter on Results and on the
 * Show Results report — is a page that must keep working for everyone else, so
 * a failure here degrades to "no classes" rather than breaking the page.
 * Server-only: it reads the session.
 *
 * A `WITHDRAWN` entry is left out, as every count on the backend leaves it
 * out: the exhibitor is not in that class any more.
 */
export async function fetchMyShowEntries(showId: string, userId: string): Promise<MyShowEntries> {
  const none: MyShowEntries = { classIds: [], entryIds: [] };
  try {
    const headers = await getAuthHeaders();
    if (!headers) return none;
    const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return none;
    const data = await res.json();
    const mine = ((data.entries ?? []) as { show_id: string; class_id: string; entry_id: string; status?: string }[])
      .filter((e) => e.show_id === showId && e.status !== 'WITHDRAWN');
    return {
      // A pattern class may hold two of one exhibitor's entries, on two horses.
      classIds: [...new Set(mine.map((e) => e.class_id))],
      entryIds: mine.map((e) => e.entry_id),
    };
  } catch {
    return none;
  }
}

/** The classes the signed-in exhibitor is entered in at one show. */
export async function fetchRegisteredClassIds(showId: string, userId: string): Promise<string[]> {
  return (await fetchMyShowEntries(showId, userId)).classIds;
}
