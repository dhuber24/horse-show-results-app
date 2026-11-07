/**
 * A show's discussion board (migration 183) — the payload `GET /shows/{id}/board`
 * returns, and the little the screen works out from it.
 *
 * The backend decides everything that is a rule: who a post is shown as (an
 * anonymous post names nobody but to a GaitDesk admin), what a reader may see
 * (a hidden post is a moderator's alone), and whether they may post now. This
 * file only labels and orders what came back — see `routers/show_board.py`.
 */

export type BoardMode = 'open' | 'signed_in' | 'closed';
export type BoardCategory = 'general' | 'question' | 'callout' | 'update' | 'lost_found';

export type BoardAuthor = {
  name: string | null;
  badge: string | null;
  back_number: number | null;
  anonymous: boolean;
  /** Who is behind an anonymous post — sent to a GaitDesk admin only. */
  revealed: { name: string | null; badge: string | null; user_id: string | null } | null;
};

export type BoardPost = {
  id: string;
  parent_id: string | null;
  category: BoardCategory;
  /** Null on the placeholder left by a deleted post with replies under it. */
  body: string | null;
  created_at: string;
  pinned: boolean;
  /** Only a moderator is ever sent a hidden post. */
  hidden: boolean;
  deleted: boolean;
  author: BoardAuthor;
  is_mine: boolean;
};

export type BoardThread = BoardPost & { replies: BoardPost[] };

export type BoardPayload = {
  show_status: string;
  mode: BoardMode;
  can_post: boolean;
  posting_refusal: string | null;
  signed_in: boolean;
  /** Who the composer posts as; null for a visitor, and on a poll. */
  posting_as: { name: string | null; badge: string | null; back_number: number | null } | null;
  can_moderate: boolean;
  threads: BoardThread[];
  has_more: boolean;
  next_before: string | null;
};

/** How often an open board asks for what is new. The gate board's cadence. */
export const BOARD_POLL_MS = 10_000;

/** Matches `MAX_BODY_CHARS` in `routers/show_board.py`. */
export const MAX_POST_CHARS = 2000;

export const CATEGORIES: { value: BoardCategory; label: string; icon: string }[] = [
  { value: 'general', label: 'General', icon: '💬' },
  { value: 'question', label: 'Question', icon: '❓' },
  { value: 'callout', label: 'Callout', icon: '📣' },
  { value: 'update', label: 'Show Update', icon: '📌' },
  { value: 'lost_found', label: 'Lost & Found', icon: '🔎' },
];

export function categoryOf(value: BoardCategory) {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[0];
}

export const MODE_OPTIONS: { value: BoardMode; label: string; hint: string }[] = [
  { value: 'open', label: 'Open to everybody', hint: 'Visitors without an account can post.' },
  { value: 'signed_in', label: 'Signed-in only', hint: 'Only people with a GaitDesk account can post.' },
  { value: 'closed', label: 'Closed', hint: 'Nobody can post. What’s already up stays up.' },
];

type Named = { name: string | null; badge: string | null; back_number: number | null };

/** The badge beside a name: "Exhibitor #42", "Show Office", or null for none. */
export function badgeText(author: Named): string | null {
  if (!author.badge) return null;
  return author.back_number != null ? `${author.badge} #${author.back_number}` : author.badge;
}

/** The byline: "Jo Smith · Exhibitor #42", "Anonymous", "Visitor". */
export function byline(author: Named): string {
  const name = author.name ?? 'Unknown';
  const badge = badgeText(author);
  return badge ? `${name} · ${badge}` : name;
}

/**
 * The board as shown: the poll's first page, then any older threads the
 * reader loaded by hand that the first page doesn't already hold. A thread can
 * move from "older" onto the first page — pinned, say — and must not be shown
 * twice.
 */
export function combineThreads(firstPage: BoardThread[], older: BoardThread[]): BoardThread[] {
  const seen = new Set(firstPage.map((t) => t.id));
  return [...firstPage, ...older.filter((t) => !seen.has(t.id))];
}
