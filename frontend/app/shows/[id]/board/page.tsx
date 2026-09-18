import { fetchShow, fetchClasses, fetchResultsIndex } from '@/lib/api';
import AutoRefresh from '@/components/AutoRefresh';
import LiveBoard from './LiveBoard';

// Full-screen venue display — no <Navbar> chrome, no visible nav or footer,
// meant for a TV or lobby monitor rather than a hand-held screen. Public and
// unauthenticated like /live, /schedule and /results: this is the same
// at-the-rail data, just projected instead of scrolled.
export const metadata = {
  title: 'Live Results Board',
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
