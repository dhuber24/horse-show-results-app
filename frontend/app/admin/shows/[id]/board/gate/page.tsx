import { Suspense } from 'react';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { BoardClass } from '@/lib/gate-board';
import GateBoard from './GateBoard';

// The Gate Board — a full-screen display for the TV at a ring's in-gate: the
// class in the ring, the class on deck and the one in the hole with their
// riders and who the gate has checked in, and what comes after.
//
// Under /admin with the other live screens, because putting a board up is the
// office's call; the admin layout's role gate is the protection, and whoever
// puts it up signs in once on the TV's browser and leaves it running. It reads
// the gate's own class list and riders — `GET /shows/{id}/gate/classes` and
// `.../classes/{cid}/entries` — which the show office may read, so the board
// is served by the endpoints the steward's screen already uses.
//
// Opened bare, this route is the **Gate Board page** — which ring, and what
// size the screen is. `?ring=` and `?size=` are the board itself. The board
// polls the gate on its own after this first load: see GateBoard.
export const metadata = {
  title: 'Gate Board',
};

export default async function GateBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classesRes] = await Promise.all([
    fetchShow(id),
    fetch(`${API_URL}/shows/${id}/gate/classes`, { headers: headers ?? {}, cache: 'no-store' }),
  ]);
  const body = await readJsonBody(classesRes);
  const classes: BoardClass[] | null = classesRes.ok && Array.isArray(body) ? body : null;
  const loadError = classes
    ? null
    : classesRes.status === 403
      ? 'You don’t work this show, so its gate cannot be read. Ask the show office to add you.'
      : 'The classes could not be loaded. Refresh to try again.';

  return (
    // GateBoard reads `?ring=` and `?size=` through useSearchParams, which
    // wants a boundary above it. It renders nothing until mounted anyway.
    <Suspense fallback={null}>
      <GateBoard showId={id} show={show} initialClasses={classes ?? []} loadError={loadError} />
    </Suspense>
  );
}
