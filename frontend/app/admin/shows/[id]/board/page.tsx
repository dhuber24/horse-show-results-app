import { fetchShow, fetchClasses, fetchResultsIndex } from '@/lib/api';
import AutoRefresh from '@/components/AutoRefresh';
import LiveBoard from './LiveBoard';

// Full-screen venue display — no <Navbar> chrome, no visible nav or footer,
// meant for a TV or lobby monitor rather than a hand-held screen.
//
// Lives under /admin, not with the public rail screens, because putting a show
// on a wall is the office's call. Anyone can read the placings on /results;
// nobody outside the office should be able to stand up a full-screen board for
// a show that is not theirs. The admin layout's role gate is the whole of the
// protection here — the display itself is meant to be read by a room, so the
// person who opens it signs in once on the TV's browser and leaves it running.
//
// What it *shows* is unchanged by that move: still only posted results, the
// same public `results-index` payload the Results page reads. Staff-only is
// about who can put the board up, not about showing the room anything the
// room could not already look up.
export const metadata = {
  title: 'Live Screens',
};

export default async function ShowBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, resultsIndex] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchResultsIndex(id),
  ]);

  return (
    <>
      {/* The board re-fetches on its own timer rather than waiting on someone
          to reload the tab it's projected from. */}
      <AutoRefresh intervalMs={12000} />
      <LiveBoard showId={id} show={show} classes={classes} resultsIndex={resultsIndex} />
    </>
  );
}
