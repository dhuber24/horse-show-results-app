import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** Have an invoice issued now for the finished shows not yet invoiced. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/settle-up/invoice`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
