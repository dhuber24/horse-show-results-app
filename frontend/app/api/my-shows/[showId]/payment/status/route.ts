import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ showId: string }> };

/** Where a payment stands after the bank asked the payer to confirm. */
export async function POST(req: NextRequest, { params }: Params) {
  const { showId } = await params;
  return relayToBackend(`/my-shows/${showId}/payment/status`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
