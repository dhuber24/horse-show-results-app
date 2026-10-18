import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string }> };

/** Whether the caller can pay their balance at this show online (migration 172). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { showId } = await params;
  return relayToBackend(`/my-shows/${showId}/payment`);
}

/** Pay the balance at the quoted total, to the show company's own Stripe account. */
export async function POST(req: NextRequest, { params }: Params) {
  const { showId } = await params;
  return relayToBackend(`/my-shows/${showId}/payment`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
