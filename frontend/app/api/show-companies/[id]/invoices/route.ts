import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ id: string }> };

/** GaitDesk's invoices to a show company (migration 172). ADMIN only. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return relayToBackend(`/show-companies/${id}/invoices`);
}

/** Issue an invoice off the usage statement, net 30. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return relayToBackend(`/show-companies/${id}/invoices`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
