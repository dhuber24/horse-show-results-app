import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string; invoiceId: string }> };

/** What the payment form needs to pay one GaitDesk invoice (migration 172). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { companyId, invoiceId } = await params;
  return relayToBackend(`/my-company/${companyId}/invoices/${invoiceId}/payment`);
}
