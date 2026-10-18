import { NextRequest, NextResponse } from 'next/server';
import { API_URL, safeFetchBackend } from '@/lib/backend-fetch';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Stripe's webhook for the show companies' own accounts — exhibitors' payments (migration 172). Stripe cannot reach the API —
 * every request to it carries the internal key — so this forwards the delivery
 * with its body untouched: the backend checks the signature against these
 * exact bytes, and parsing and re-serialising the JSON would break it. No
 * session: Stripe is the caller, and the signature is its proof.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  const { json, status } = await safeFetchBackend(`${API_URL}/payments/stripe/webhook?connect=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
      'Stripe-Signature': signature,
    },
    body: await req.text(),
    cache: 'no-store',
  });
  return NextResponse.json(json, { status });
}
