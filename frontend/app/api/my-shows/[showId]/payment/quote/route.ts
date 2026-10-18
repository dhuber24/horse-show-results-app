import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string }> };

/** The total for paying the balance with what was entered, card fee included. Charges nothing. */
export async function POST(req: NextRequest, { params }: Params) {
  const { showId } = await params;
  return relayToBackend(`/my-shows/${showId}/payment/quote`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
