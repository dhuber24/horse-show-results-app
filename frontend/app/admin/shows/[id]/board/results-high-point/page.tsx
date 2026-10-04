import { Suspense } from 'react';
import { fetchShow, fetchClasses, fetchResultsIndex, fetchMarquee, fetchShowLeaderboard } from '@/lib/api';
import AutoRefresh from '@/components/AutoRefresh';
import LiveBoard from '../results/LiveBoard';

// The Results & High Point board: the Results Board split down the middle,
// one division at a time: each of its classes on the left — two judges' cards
// at a time — beside that division's high point standings on the right.
//
// The same board as `/board/results` in every other way — the sizes, full
// screen, duplicate and extend, the marquee, the QR code — so it is that
// component with `layout="split"`, not a second copy of it. Staff-only for
// the reason that one is; what it shows is public, the standings being the
// same `leaderboard` payload `/shows/[id]/leaderboard` reads.
export const metadata = {
  title: 'Results & High Point',
};

export default async function ResultsHighPointBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, resultsIndex, marquee, leaderboard] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchResultsIndex(id),
    fetchMarquee(id),
    fetchShowLeaderboard(id),
  ]);

  return (
    <>
      {/* The standings come round on the same poll as the placings, so a class
          posted in the office moves both halves within twelve seconds. */}
      <AutoRefresh intervalMs={12000} />
      <Suspense fallback={null}>
        <LiveBoard
          showId={id}
          show={show}
          classes={classes}
          resultsIndex={resultsIndex}
          marquee={marquee}
          layout="split"
          leaderboard={leaderboard}
        />
      </Suspense>
    </>
  );
}
