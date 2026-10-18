import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** Where a Pro+ payment stands after the bank asked the payer to confirm. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/pro-plus/payment-status`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
