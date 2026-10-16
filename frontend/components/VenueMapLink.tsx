import { venueMapUrl } from '@/lib/venue';

/**
 * The 📍 and the venue's name beside a show, opening the venue in a maps app.
 *
 * The pin and the name are one link, not the pin alone: an emoji is too small a
 * target on a phone, which is where this gets pressed — in a truck, on the way
 * to the barns. `address` is the show payload's `venue_address`; without one the
 * search runs on the name, which still finds most fairgrounds.
 *
 * Inside a card that is itself a link, the card's link has to be stretched over
 * it (`after:inset-0`) and this one passed `relative z-10` — a link inside a link
 * is not valid HTML. See `app/ShowList.tsx`.
 */
export default function VenueMapLink({
  venue,
  address,
  className = '',
}: {
  venue?: string | null;
  address?: string | null;
  className?: string;
}) {
  const href = venueMapUrl(venue, address);
  if (!venue || !href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={address ? `Open in Maps: ${address}` : 'Open in Maps'}
      className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${className}`}
    >
      {/* inline-block, so the link's underline runs under the name only. */}
      <span aria-hidden="true" className="inline-block mr-1">📍</span>
      {venue}
    </a>
  );
}
