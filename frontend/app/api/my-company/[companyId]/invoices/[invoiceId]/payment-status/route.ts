import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string; invoiceId: string }> };

/** Where a payment on an invoice stands, after the bank asked the payer to confirm. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId, invoiceId } = await params;
  return relayToBackend(`/my-company/${companyId}/invoices/${invoiceId}/payment-status`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
