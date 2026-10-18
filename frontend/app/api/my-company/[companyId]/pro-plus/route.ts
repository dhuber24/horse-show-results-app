import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** What buying a Pro+ year now costs, and the year it buys (migration 173). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/pro-plus`);
}
