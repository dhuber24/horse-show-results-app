import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string; invoiceId: string }> };

/** Pay a GaitDesk invoice at the quoted total (migration 172). */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId, invoiceId } = await params;
  return relayToBackend(`/my-company/${companyId}/invoices/${invoiceId}/pay`, { method: 'POST', body: await req.json().catch(() => ({})) });
}
