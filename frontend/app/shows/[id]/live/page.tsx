import ShowHub from '../_components/ShowHub';
import { loadShowHub } from '../_components/loadShowHub';

/**
 * Where the Active Shows list and the office's *Public Results* tile land: the
 * show menu, for everybody.
 *
 * The same page as `/shows/[id]` — one component and one loader, so the public
 * results hub and the show's own page cannot drift apart again. It is not a
 * redirect there: at `/shows/[id]` a scribe or an admin gets the class list
 * they score from while the show runs, and the office opens this to see what
 * the public sees. Any link already pointing here keeps working too.
 *
 * The full-screen results board is deliberately not here. It lives at
 * /admin/shows/[id]/board/results, behind the office's sign-in: standing a show
 * up on a wall is staff's call, not something a spectator opens from the hub.
 * The placings it shows are public either way — /results is the same data.
 */
export default async function ShowLiveHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShowHub {...await loadShowHub(id)} />;
}
