import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ id: string; invoiceId: string }> };

/** Cancel an invoice issued in error. ADMIN only. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, invoiceId } = await params;
  return relayToBackend(`/show-companies/${id}/invoices/${invoiceId}/void`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
