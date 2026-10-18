import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** Buy a Pro+ year at the quoted total. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/pro-plus/pay`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
