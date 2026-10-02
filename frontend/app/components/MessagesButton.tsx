'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** A show's office pages (`/admin/shows/{id}/…`) and its public ones
 *  (`/shows/{id}/…`), the same two the staff sidebar recognises. */
const SHOW_IN_PATH =
  /^\/(?:admin\/)?shows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

type Inbox = {
  /** What this answer is for: a show's id, or "all". Checked at render so a
   *  count from the last page never shows on this one while the new one loads. */
  key: string;
  count: number;
  href: string;
  /** Whose messages the count is, for the tooltip. */
  scope: 'show' | 'all';
};

async function readCount(url: string): Promise<number | null> {
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const json = await res.json().catch(() => null);
  return json && typeof json.unread === 'number' ? json.unread : null;
}

/**
 * The inbox, in the top bar beside the account button, on every office page.
 *
 * It was a row of a show's menu and a tile on its dashboard, which put a new
 * question from an exhibitor one screen away from wherever the office was
 * working. **On a show this person works it is that show's inbox**, with that
 * show's unread count. **Everywhere else it is every show's** — `/admin/messages`
 * and the count across all the shows they work (`GET /my-messages`) — so somebody
 * running three shows learns that anybody wrote without opening each one.
 *
 * A client component reading the address because the Navbar sits in the root
 * layout, which is not re-rendered between pages, so it cannot know which show
 * a page is about. Re-reads the count on every navigation, so reading the
 * messages clears the badge on the next page.
 *
 * The show's count endpoint checks `works_show`, so a manager browsing somebody
 * else's show gets the combined inbox rather than that show's. Rendered by the
 * Navbar for the office roles only, so an exhibitor sends no request that can
 * only be refused.
 */
export default function MessagesButton() {
  const pathname = usePathname();
  const showId = pathname.match(SHOW_IN_PATH)?.[1] ?? null;
  const key = showId ?? 'all';
  const [inbox, setInbox] = useState<Inbox | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (showId) {
        const count = await readCount(`/api/shows/${showId}/contact/messages/unread-count`);
        if (cancelled) return;
        if (count !== null) {
          setInbox({ key: showId, count, href: `/admin/shows/${showId}/messages`, scope: 'show' });
          return;
        }
      }
      const count = await readCount('/api/my-messages/unread-count');
      if (cancelled) return;
      setInbox(count === null ? null : { key, count, href: '/admin/messages', scope: 'all' });
    })();
    return () => {
      cancelled = true;
    };
  }, [showId, key, pathname]);

  if (!inbox || inbox.key !== key) return null;

  const { count, href, scope } = inbox;
  const whose = scope === 'show' ? "This show's messages" : 'Messages from all your shows';
  const label = count > 0 ? `${whose} — ${count} new` : whose;
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
