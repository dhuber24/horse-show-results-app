import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

/** Stripe's page for a trainer to change their card, switch plan or cancel (migration 172). */
export async function POST(req: NextRequest) {
  return relayToBackend('/trainers/me/billing-portal', { method: 'POST', body: await req.json().catch(() => ({})) });
}
