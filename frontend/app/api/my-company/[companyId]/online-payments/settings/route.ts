import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

type Params = { params: Promise<{ companyId: string }> };

/** Whether credit card payers pay the processing fee, or the company absorbs it. */
export async function PUT(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  return relayToBackend(`/my-company/${companyId}/online-payments/settings`, { method: 'PUT', body: await req.json().catch(() => ({})) });
}
