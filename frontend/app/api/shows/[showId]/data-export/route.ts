import { NextRequest } from 'next/server';
import { relayToBackend } from '@/lib/backend-fetch';

/**
 * The show's results as data, for the Data Export page (`backend/data_export.py`).
 *
 * Fetched by the page in the browser rather than in its server component: a
 * busy show is megabytes of rows, and handing that to a client component as a
 * prop would embed it in the page itself.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return relayToBackend(`/shows/${showId}/reports/data-export`);
}
