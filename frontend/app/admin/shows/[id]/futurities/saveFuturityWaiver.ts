import type { FuturityFormValue } from './FuturityForm';
import type { FuturityWaiver } from './futurity-shared';

/**
 * Reconcile the release typed into the futurity form with the waiver row on
 * file.
 *
 * The release on a futurity entry form is a `show_waivers` row scoped to the
 * futurity (migration 109), not a column on it — which is why saving a futurity
 * is two requests. That is deliberate: scoping an existing waiver reuses the
 * whole signature mechanism (paper signatures recorded at the desk, guardians
 * signing for youth entrants, the outstanding count on My Shows and the
 * checklist) instead of growing a second one that would have to learn all of it
 * again.
 *
 * Deleting when the wording is cleared takes the signatures with it, exactly as
 * deleting a waiver does anywhere else: a signature is agreement to *that* text,
 * and kept without it it would attest to nothing.
 *
 * Returns null on success, or a sentence naming what went wrong — the caller
 * has already saved the futurity by this point and needs to say so.
 */
export async function saveFuturityWaiver({
  showId,
  futurityId,
  existing,
  value,
}: {
  showId: string;
  futurityId: string;
  existing: FuturityWaiver | null;
  value: FuturityFormValue;
}): Promise<string | null> {
  const body = value.waiverBody.trim();
  const title = value.waiverTitle.trim();

  if (body === '') {
    if (!existing) return null;
    const res = await fetch(`/api/shows/${showId}/waivers/${existing.id}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      return 'the release could not be removed.';
    }
    return null;
  }

  const payload = {
    title: title || 'Release and waiver',
    body,
    is_required: value.waiverRequired,
    futurity_id: futurityId,
  };

  const res = existing
    ? await fetch(`/api/shows/${showId}/waivers/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    : await fetch(`/api/shows/${showId}/waivers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, sort_order: 0 }),
      });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return json?.detail || 'the release could not be saved.';
  }
  return null;
}
