'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** A show's office pages (`/admin/shows/{id}/…`) and its public ones
 *  (`/shows/{id}/…`), the same two the staff sidebar recognises. */
const SHOW_IN_PATH =
  /^\/(?:admin\/)?shows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/**
 * The show's inbox, in the top bar beside the account button.
 *
 * It was a row of the show's menu and a tile on its dashboard, which put a new
 * question from an exhibitor one screen away from wherever the office was
 * working. Up here it is on every page of the show, with the unread count on it.
 *
 * A client component reading the address because the Navbar sits in the root
 * layout, which is not re-rendered between pages, so it cannot know which show
 * a page is about. Re-reads the count on every navigation, so reading the
 * messages clears the badge on the next page.
 *
 * Shown only to somebody who works this show: the count endpoint checks
 * `works_show`, and any answer but a count renders nothing — the same test the
 * sidebar uses to offer a show's office on its public pages. Rendered by the
 * Navbar for the office roles only, so an exhibitor browsing a show does not
 * send a request that can only be refused.
 */
export default function ShowMessagesButton() {
  const pathname = usePathname();
  const showId = pathname.match(SHOW_IN_PATH)?.[1] ?? null;
  // Tagged with its show, so a count from the last show never shows on this one
  // while the new one loads.
  const [unread, setUnread] = useState<{ showId: string; count: number } | null>(null);

  useEffect(() => {
    if (!showId) return;
    let cancelled = false;
    fetch(`/api/shows/${showId}/contact/messages/unread-count`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        setUnread(json && typeof json.unread === 'number' ? { showId, count: json.unread } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [showId, pathname]);

  if (!showId || !unread || unread.showId !== showId) return null;

  const { count } = unread;
  const label = count > 0 ? `Messages — ${count} new` : 'Messages';
  const href = `/admin/shows/${showId}/messages`;
  const here = pathname === href;

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={here ? 'page' : undefined}
      title={label}
      className="relative text-sm px-3 py-2 rounded font-medium transition"
      style={{
        backgroundColor: here ? 'var(--accent)' : 'var(--slate-raised)',
        color: here ? 'var(--accent-foreground)' : 'var(--on-slate)',
      }}
    >
      <span aria-hidden>✉️</span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-semibold leading-5 text-center"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
