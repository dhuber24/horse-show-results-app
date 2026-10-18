import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** The total for a Pro+ year with what was entered, card fee included. Charges nothing. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/pro-plus/quote`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
