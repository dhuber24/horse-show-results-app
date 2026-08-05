import { API_URL } from '@/lib/backend-fetch';
import RespondToRequest, { type HorseRequest } from './RespondToRequest';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// No session required: the token is the authorization, and the person deciding
// may never have signed in — a horse can be transferred to someone whose first
// contact with the app is this link.
async function loadRequest(token: string): Promise<HorseRequest | null> {
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}`,
    {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    },
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function HorseRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const request = await loadRequest(token);

  return (
    <main className="max-w-xl mx-auto p-4 md:p-6">
      {!request ? (
        <div
          className="rounded-lg border p-5"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          <h1 className="text-xl font-bold">This link isn&apos;t valid</h1>
          <p className="text-sm mt-2">
            It may have been mistyped, or the request may have been withdrawn. Ask whoever sent it
            to share a new link.
          </p>
        </div>
      ) : (
        <RespondToRequest token={token} request={request} />
      )}
    </main>
  );
}
