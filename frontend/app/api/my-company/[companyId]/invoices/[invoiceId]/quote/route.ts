import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string; invoiceId: string }> };

/** The total for paying an invoice with what was entered, card fee included. Charges nothing. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId, invoiceId } = await params;
  return relayToBackend(`/my-company/${companyId}/invoices/${invoiceId}/quote`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
