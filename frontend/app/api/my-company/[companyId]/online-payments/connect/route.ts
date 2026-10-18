import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** Stripe's sign-up page for the company's own account. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/online-payments/connect`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
