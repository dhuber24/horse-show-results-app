/**
 * Where a venue is, for people and for a maps app.
 *
 * The 📍 beside a show opens the venue in a maps app (`components/VenueMapLink`).
 * It searches for the venue's name and its street address together: the name
 * alone finds most fairgrounds, and the address — with the zip, migration 163 —
 * settles the ones on a county road that a maps search would otherwise drop in
 * the wrong town.
 */

export interface VenueAddressParts {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** "1421 3rd Ave SE, Rochester, MN 55904", from whichever parts are set, or ''.
 *  The same line `routers/shows._venue_address` sends as `venue_address`. */
export function venueAddressLine(venue: VenueAddressParts): string {
  const clean = (v?: string | null) => (v ?? '').trim();
  const stateZip = [clean(venue.state), clean(venue.zip)].filter(Boolean).join(' ');
  return [clean(venue.address), clean(venue.city), stateZip].filter(Boolean).join(', ');
}

/**
 * A maps search for the venue, or null when there is nothing to search for.
 *
 * Google's documented cross-platform URL: it opens the Google Maps app on a
 * phone that has it and the website everywhere else, which no `geo:` or Apple
 * Maps link does on every device.
 */
export function venueMapUrl(name?: string | null, address?: string | null): string | null {
  const query = [name, address].map((v) => (v ?? '').trim()).filter(Boolean).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
