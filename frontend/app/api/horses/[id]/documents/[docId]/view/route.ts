import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

/**
 * The document, served for display rather than for saving.
 *
 * Same bytes and same access rules as the download route; only the
 * Content-Disposition differs. The registration desk shows the scan beside the
 * sign-off checkbox so staff can inspect a Coggins an exhibitor uploaded but
 * left the paper copy of at home — downloading a stranger's veterinary
 * paperwork onto the office laptop to read it is not the same thing.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/horses/${id}/documents/${docId}/download?inline=true`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ error: 'Document not found' }, { status: res.status });

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') || 'inline',
      // Veterinary paperwork for a named animal and owner. No shared cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
