import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** The finished shows the company must pay for before it sets up another (migration 173). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/settle-up`);
}
