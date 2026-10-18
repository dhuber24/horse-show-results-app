import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ id: string }> };

/** Whether a company is held back from setting up a show, and by which shows. ADMIN only. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return relayToBackend(`/show-companies/${id}/settle-up`);
}
