import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ id: string; invoiceId: string }> };

/** Mark an invoice paid by check, wire or other means outside the app. ADMIN only. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, invoiceId } = await params;
  return relayToBackend(`/show-companies/${id}/invoices/${invoiceId}/payment`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
