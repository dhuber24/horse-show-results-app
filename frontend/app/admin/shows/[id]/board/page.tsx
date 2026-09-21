import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchShow } from '@/lib/api';

// The Live Screens page: which screen to put up. Where the dashboard's Live
// Screens tile lands, every time — it carries no size and remembers none, so
// nothing skips it.
//
// Two screens, each its own page behind it: the Results Board
// (`/board/results`, sizes and the marquee, then the board) and the Gate Board,
// which is not built yet. Each owns its own settings, so this page stays a
// choice between screens rather than a form that grows a section per board.
//
// Same full-screen dark panel as the boards, because it is usually opened on
// the TV's own browser, in the tab the board will run in.
export const metadata = {
  title: 'Live Screens',
};

export default async function LiveScreensPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  // The results board ran at this address until it moved to `/board/results`,
  // and a TV's browser may be bookmarked on `?size=hall` for one screen. That
  // link keeps opening the board rather than a page of choices.
  if (typeof query.size === 'string') {
    const forward = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') forward.set(key, value);
    }
    redirect(`/admin/shows/${id}/board/results?${forward.toString()}`);
  }

  const show = await fetchShow(id);

  const card = {
    padding: '3vh',
    backgroundColor: 'var(--slate-raised)',
    border: '0.2vh solid var(--on-slate-muted)',
    color: 'var(--on-slate)',
  } as const;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'var(--slate)' }}>
      <div className="mx-auto flex flex-col" style={{ maxWidth: '150vh', padding: '4vh 16px', gap: '4vh' }}>
        <header className="flex items-end justify-between flex-wrap" style={{ gap: '1.4vh' }}>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: 'max(24px, 4.2vh)', color: 'var(--on-slate)' }}>
              Live Screens
            </h1>
            <p className="truncate" style={{ fontSize: 'max(14px, 2vh)', color: 'var(--on-slate-muted)' }}>
              {show.name}
            </p>
          </div>
          <Link
            href={`/admin/shows/${id}`}
            className="hover:underline"
            style={{ fontSize: 'max(14px, 1.9vh)', color: 'var(--accent-light)' }}
          >
            ← Back to the show
          </Link>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '2.4vh' }}>
          <Link
            href={`/admin/shows/${id}/board/results`}
            className="rounded-xl text-left transition hover:brightness-125 block"
            style={card}
          >
            <div style={{ fontSize: 'max(32px, 5vh)' }} aria-hidden>
              🏆
            </div>
            <div className="font-bold" style={{ fontSize: 'max(20px, 3vh)', marginTop: '1vh' }}>
              Results Board
            </div>
            <div style={{ fontSize: 'max(14px, 1.9vh)', marginTop: '1vh', color: 'var(--on-slate-muted)' }}>
              Posted placings, four classes to a screen, for a lobby or ring-side TV — and the message
              that scrolls along the bottom.
            </div>
          </Link>

          {/* Not built yet. On the page now so the gate board arrives as the
              second card rather than as a rearrangement — disabled, with a
              title that says why, rather than a link to nothing. */}
          <button
            type="button"
            disabled
            title="Not available yet — the gate board is still being built"
            className="rounded-xl text-left flex flex-col items-start justify-start cursor-not-allowed"
            style={{ ...card, opacity: 0.55 }}
          >
            <div style={{ fontSize: 'max(32px, 5vh)' }} aria-hidden>
              🚪
            </div>
            <div className="font-bold" style={{ fontSize: 'max(20px, 3vh)', marginTop: '1vh' }}>
              Gate Board
            </div>
            <div style={{ fontSize: 'max(14px, 2vh)', color: 'var(--accent-light)' }}>Coming soon</div>
            <div style={{ fontSize: 'max(14px, 1.9vh)', marginTop: '1vh', color: 'var(--on-slate-muted)' }}>
              The order of go and who is on deck, for the riders waiting to go in.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
