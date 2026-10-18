import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

/** Subscribe to Trainer Registry Pro by card: the Stripe Checkout page to go to (migration 172). */
export async function POST(req: NextRequest) {
  return relayToBackend('/trainers/me/pro-checkout', { method: 'POST', body: await req.json().catch(() => ({})) });
}
