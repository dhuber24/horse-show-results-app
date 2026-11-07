'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import {
  BOARD_POLL_MS,
  CATEGORIES,
  MAX_POST_CHARS,
  MODE_OPTIONS,
  badgeText,
  byline,
  categoryOf,
  combineThreads,
  type BoardCategory,
  type BoardMode,
  type BoardPayload,
  type BoardPost,
  type BoardThread,
} from '@/lib/show-board';

/**
 * The board itself: the composer, the threads, and — for the show office —
 * the board's setting and each post's Hide and Pin.
 *
 * Polls every ten seconds from the browser while the tab is in view, like the
 * gate board, and says so when a poll fails rather than going quietly stale.
 * Older threads are loaded by hand and kept beneath the polled first page.
 *
 * Nothing here decides a rule. Who a post is shown as, which posts a reader is
 * sent and whether they may post are all the backend's (`routers/show_board.py`);
 * the screen offers only what the payload says the reader may do.
 */

const TIME_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

type PostingAs = BoardPayload['posting_as'];

type Ctx = {
  showId: string;
  canPost: boolean;
  canModerate: boolean;
  signedIn: boolean;
  postingAs: PostingAs;
  /** After any change: re-read the board. */
  changed: () => void;
  /** A change to a thread the poll does not carry (an older one). */
  patchOlder: (postId: string, change: Partial<BoardPost> | null) => void;
};

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const json = await res.json().catch(() => null);
    return errorMessage(json, 'That didn’t work. Please try again.');
  } catch {
    return 'Network error — please try again.';
  }
}

export default function DiscussionBoard({ showId, initial }: { showId: string; initial: BoardPayload }) {
  const [board, setBoard] = useState(initial);
  const [older, setOlder] = useState<BoardThread[]>([]);
  const [olderCursor, setOlderCursor] = useState<{ hasMore: boolean; before: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<BoardCategory | 'all'>('all');
  // Who the composer posts as is asked for once, on the first load; the polls
  // leave it out.
  const postingAs = initial.posting_as;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/shows/${showId}/board?with_viewer=0`, { cache: 'no-store' });
      if (!res.ok) {
        setStale(true);
        return;
      }
      setBoard((await res.json()) as BoardPayload);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [showId]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(tick, BOARD_POLL_MS);
    // Coming back to the tab reads the board at once rather than up to ten
    // seconds later.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const patchOlder = useCallback((postId: string, change: Partial<BoardPost> | null) => {
    setOlder((threads) =>
      threads
        .filter((t) => !(change === null && t.id === postId))
        .map((t) =>
          t.id === postId
            ? { ...t, ...change }
            : {
                ...t,
                replies: t.replies
                  .filter((r) => !(change === null && r.id === postId))
                  .map((r) => (r.id === postId ? { ...r, ...change } : r)),
              },
        ),
    );
  }, []);

  // Older pages run from the first page's cursor until one has been loaded.
  const more = olderCursor ?? { hasMore: board.has_more, before: board.next_before };

  const loadOlder = async () => {
    if (!more.before) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/shows/${showId}/board?with_viewer=0&before=${encodeURIComponent(more.before)}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const page = (await res.json()) as BoardPayload;
        setOlder((threads) => [...threads, ...page.threads]);
        setOlderCursor({ hasMore: page.has_more, before: page.next_before });
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  const ctx: Ctx = {
    showId,
    canPost: board.can_post,
    canModerate: board.can_moderate,
    signedIn: board.signed_in,
    postingAs,
    changed: () => void refresh(),
    patchOlder,
  };

  const threads = combineThreads(board.threads, older).filter(
    (t) => filter === 'all' || t.category === filter,
  );
  const returnTo = encodeURIComponent(`/shows/${showId}/board`);

  return (
    <div>
      {board.can_moderate && <BoardSetting showId={showId} mode={board.mode} onChanged={ctx.changed} />}

      {board.can_post ? (
        <div
          className="mb-5 rounded-lg border p-4"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Composer ctx={ctx} parentId={null} />
        </div>
      ) : (
        <div
          className="mb-5 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
        >
          {board.posting_refusal}
          {!board.signed_in && board.mode === 'signed_in' && (
            <>
              {' '}
              <Link href={`/login?next=${returnTo}`} className="font-medium underline">
                Sign in
              </Link>
            </>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show posts about">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.value}
            active={filter === c.value}
            onClick={() => setFilter(c.value)}
            label={`${c.icon} ${c.label}`}
          />
        ))}
        {stale && (
          <span className="ml-auto text-xs font-semibold" style={{ color: 'var(--error)' }}>
            Not updating — retrying
          </span>
        )}
      </div>

      {threads.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
          {filter === 'all'
            ? 'Nothing posted yet.'
            : `No ${categoryOf(filter).label.toLowerCase()} posts yet.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <ThreadCard thread={thread} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}

      {more.hasMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            title={loadingOlder ? 'Loading older posts…' : undefined}
            className="text-sm font-medium px-4 py-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
          >
            {loadingOlder ? 'Loading…' : 'Show older posts'}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="text-xs font-medium px-3 py-1.5 rounded-full border"
      style={
        active
          ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-foreground)' }
          : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-deep)' }
      }
    >
      {label}
    </button>
  );
}

/** The show office's one setting: who may post. */
function BoardSetting({ showId, mode, onChanged }: { showId: string; mode: BoardMode; onChanged: () => void }) {
  const [saving, setSaving] = useState<BoardMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: BoardMode) => {
    if (next === mode) return;
    setSaving(next);
    setError(null);
    const failed = await send(`/api/shows/${showId}/board/settings`, 'PUT', { mode: next });
    setSaving(null);
    if (failed) setError(failed);
    else onChanged();
  };

  return (
    <div
      className="mb-5 rounded-lg border p-3"
      style={{ backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent-border)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
        Show office · who can post
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODE_OPTIONS.map((option) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              disabled={saving !== null}
              title={saving !== null ? 'Saving…' : option.hint}
              aria-pressed={selected}
              className="text-left rounded border px-3 py-2"
              style={{
                backgroundColor: selected ? 'var(--surface)' : 'transparent',
                borderColor: selected ? 'var(--accent)' : 'var(--accent-border)',
              }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                {saving === option.value ? 'Saving…' : option.label}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{option.hint}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
        Posts go up straight away. Use <strong>Hide</strong> on any post to take it down; only you and
        other show office staff will still see it.
      </p>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}

/** A new post, or a reply when `parentId` is set. */
function Composer({ ctx, parentId, onDone }: { ctx: Ctx; parentId: string | null; onDone?: () => void }) {
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<BoardCategory>('general');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const tooLong = trimmed.length > MAX_POST_CHARS;
  const returnTo = encodeURIComponent(`/shows/${ctx.showId}/board`);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || tooLong) return;
    setSending(true);
    setError(null);
    const failed = await send(`/api/shows/${ctx.showId}/board/posts`, 'POST', {
      body: trimmed,
      category: parentId ? 'general' : category,
      is_anonymous: ctx.signedIn && anonymous,
      parent_id: parentId,
    });
    setSending(false);
    if (failed) {
      setError(failed);
      return;
    }
    setBody('');
    setAnonymous(false);
    ctx.changed();
    onDone?.();
  };

  const who = !ctx.signedIn
    ? 'Visitor'
    : anonymous
      ? 'Anonymous'
      : ctx.postingAs
        ? byline(ctx.postingAs)
        : 'your account';
  const disabledWhy = sending
    ? 'Posting…'
    : !trimmed
      ? 'Write something first'
      : tooLong
        ? `Keep it to ${MAX_POST_CHARS} characters`
        : undefined;

  return (
    <form onSubmit={submit}>
      {!parentId && (
        <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label="What kind of post">
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.value}
              active={category === c.value}
              onClick={() => setCategory(c.value)}
              label={`${c.icon} ${c.label}`}
            />
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor={`board-body-${parentId ?? 'new'}`}>
        {parentId ? 'Your reply' : 'Your post'}
      </label>
      <textarea
        id={`board-body-${parentId ?? 'new'}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={parentId ? 2 : 3}
        placeholder={parentId ? 'Write a reply…' : 'Ask a question, call out a class, post an update…'}
        className="w-full rounded border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {ctx.signedIn && (
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Post anonymously
          </label>
        )}
        <span className="text-xs" style={{ color: tooLong ? 'var(--error)' : 'var(--muted)' }}>
          {trimmed.length > MAX_POST_CHARS - 200 && `${trimmed.length}/${MAX_POST_CHARS} · `}
          Posting as <strong>{who}</strong>
        </span>
        <div className="ml-auto flex gap-2">
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="text-sm px-3 py-1.5 rounded border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-deep)' }}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={disabledWhy !== undefined}
            title={disabledWhy}
            className="text-sm font-semibold px-4 py-1.5 rounded disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {sending ? 'Posting…' : parentId ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>
      {ctx.signedIn && anonymous && (
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Your name won&rsquo;t be shown to anybody on the board, the show office included. GaitDesk
          keeps a record of who posted, which only GaitDesk staff can see, so abuse can be dealt with.
        </p>
      )}
      {!ctx.signedIn && !parentId && (
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          <Link href={`/login?next=${returnTo}`} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>{' '}
          to post under your name.
        </p>
      )}
      {error && <p className="text-sm mt-2" style={{ color: 'var(--error)' }}>{error}</p>}
    </form>
  );
}

function ThreadCard({ thread, ctx }: { thread: BoardThread; ctx: Ctx }) {
  const [replying, setReplying] = useState(false);
  const canReply = ctx.canPost && !thread.deleted && !thread.hidden;

  return (
    <article
      className="rounded-lg border p-4"
      style={{
        backgroundColor: thread.hidden ? 'var(--muted-bg)' : thread.pinned ? 'var(--accent-bg)' : 'var(--surface)',
        borderColor: thread.pinned ? 'var(--accent-border)' : 'var(--border)',
      }}
    >
      <PostView post={thread} ctx={ctx} top />

      {thread.replies.length > 0 && (
        <ul className="mt-3 space-y-3 border-l-2 pl-3" style={{ borderColor: 'var(--border)' }}>
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <PostView post={reply} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}

      {canReply &&
        (replying ? (
          <div className="mt-3 border-l-2 pl-3" style={{ borderColor: 'var(--border)' }}>
            <Composer ctx={ctx} parentId={thread.id} onDone={() => setReplying(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="mt-3 text-sm font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Reply
          </button>
        ))}
    </article>
  );
}

function PostView({ post, ctx, top = false }: { post: BoardPost; ctx: Ctx; top?: boolean }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (post.deleted) {
    return (
      <p className="text-sm italic" style={{ color: 'var(--muted)' }}>
        The author deleted this post.
      </p>
    );
  }

  const url = `/api/shows/${ctx.showId}/board/posts/${post.id}`;
  const act = async (method: string, body: unknown, change: Partial<BoardPost> | null) => {
    setBusy(true);
    setError(null);
    const failed = await send(url, method, body);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setConfirmingDelete(false);
    ctx.patchOlder(post.id, change);
    ctx.changed();
  };

  const category = categoryOf(post.category);
  const badge = badgeText(post.author);
  const official = post.author.badge === 'Show Office' || post.author.badge === 'GaitDesk';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {top && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
          >
            {category.icon} {category.label}
          </span>
        )}
        {post.pinned && (
          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>📌 Pinned</span>
        )}
        {post.hidden && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
            title="Only the show office can see this post"
          >
            Hidden
          </span>
        )}
        <span className="font-semibold" style={{ color: post.author.anonymous ? 'var(--muted)' : 'var(--foreground)' }}>
          {post.author.name}
        </span>
        {badge && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={
              official
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }
                : { backgroundColor: 'var(--muted-bg)', color: 'var(--text-deep)' }
            }
          >
            {badge}
          </span>
        )}
        <LocalTime iso={post.created_at} format={TIME_FORMAT} className="text-xs" style={{ color: 'var(--muted)' }} />
      </div>

      <p className="mt-1.5 text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-deep)' }}>
        {post.body}
      </p>

      {post.author.revealed && (
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          Posted anonymously by <strong>{byline({ ...post.author.revealed, back_number: null })}</strong> — only
          GaitDesk admins see this.
        </p>
      )}

      {(post.is_mine || ctx.canModerate) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {ctx.canModerate && (
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Saving…' : post.hidden ? 'Put this post back on the board' : 'Take this post off the board'}
              onClick={() => act('PATCH', { hidden: !post.hidden }, { hidden: !post.hidden })}
              className="font-medium hover:underline"
              style={{ color: 'var(--text-deep)' }}
            >
              {post.hidden ? 'Unhide' : 'Hide'}
            </button>
          )}
          {ctx.canModerate && top && (
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Saving…' : post.pinned ? 'Stop keeping this at the top' : 'Keep this at the top of the board'}
              onClick={() => act('PATCH', { pinned: !post.pinned }, { pinned: !post.pinned })}
              className="font-medium hover:underline"
              style={{ color: 'var(--text-deep)' }}
            >
              {post.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {post.is_mine &&
            (confirmingDelete ? (
              <span className="flex items-center gap-2">
                <span style={{ color: 'var(--error)' }}>Delete this post?</span>
                <button
                  type="button"
                  disabled={busy}
                  title={busy ? 'Deleting…' : undefined}
                  onClick={() => act('DELETE', undefined, null)}
                  className="font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--error)', color: 'var(--surface)' }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="font-medium hover:underline"
                  style={{ color: 'var(--text-deep)' }}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="font-medium hover:underline"
                style={{ color: 'var(--error)' }}
              >
                Delete
              </button>
            ))}
        </div>
      )}
      {error && <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
