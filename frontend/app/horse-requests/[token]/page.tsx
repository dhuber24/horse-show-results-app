import Link from 'next/link';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import RespondToRequest, { type HorseRequest } from './RespondToRequest';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * The decision page for a horse link or transfer request.
 *
 * A session **is** required, and that is the point. The link is handed to the
 * person who *sent* the request — deliberately, so an undelivered email never
 * strands a horse — which means anyone treating the link as the authorization
 * has built a consent step the requester can grant themselves. Only being
 * signed in as the owner proves whose horse this is.
 *
 * So there are four outcomes, and each gets its own screen:
 *   401  not signed in       → sign in, then come straight back here
 *   403  signed in, not them → explain who has to open it
 *   404  no such request     → bad or withdrawn link
 *   200  the approver        → the actual approve/decline card
 */
async function loadRequest(
  token: string,
): Promise<{ status: number; request: HorseRequest | null; message: string | null }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/horse-access-requests/by-token/${encodeURIComponent(token)}`,
    {
      headers: authHeaders ?? { 'Content-Type': 'application/json', 'X-API-Key': INTERNAL_API_KEY },
      cache: 'no-store',
    },
  );
  const json = await readJsonBody(res);
  if (res.ok) return { status: res.status, request: json as HorseRequest, message: null };
  const detail = json?.detail;
  return {
    status: res.status,
    request: null,
    message: typeof detail === 'string' ? detail : (detail?.message ?? null),
  };
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'error' | 'neutral';
  title: string;
  children: React.ReactNode;
}) {
  const palette = {
    warn: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
    error: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
    neutral: { bg: '#faf7f2', border: '#d4b896', text: '#5d4a37' },
  }[tone];
  return (
    <div
      className="rounded-lg border p-5"
      style={{ backgroundColor: palette.bg, borderColor: palette.border }}
    >
      <h1 className="text-xl font-bold" style={{ color: palette.text }}>{title}</h1>
      <div className="text-sm mt-2" style={{ color: palette.text }}>{children}</div>
    </div>
  );
}

export default async function HorseRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { status, request, message } = await loadRequest(token);

  const here = `/horse-requests/${encodeURIComponent(token)}`;

  return (
    <main className="max-w-xl mx-auto p-4 md:p-6">
      {status === 401 ? (
        <Notice tone="neutral" title="Sign in to answer this request">
          <p>
            {message ??
              'Only the owner of the horse can approve this, so the app has to know who you are.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(here)}`}
              className="text-sm font-medium px-3 py-2 rounded"
              style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
            >
              Sign in
            </Link>
            <Link
              href={`/register?next=${encodeURIComponent(here)}`}
              className="text-sm font-medium px-3 py-2 rounded border"
              style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
            >
              Create an account
            </Link>
          </div>
          <p className="text-xs mt-3" style={{ color: '#8b7355' }}>
            You&rsquo;ll come straight back to this request once you&rsquo;re in.
          </p>
        </Notice>
      ) : status === 403 ? (
        <Notice tone="warn" title="This one isn’t yours to answer">
          <p>
            {message ??
              'This request is waiting on the owner of the horse to answer it.'}
          </p>
          <p className="mt-2">
            If you sent it, the owner has to open this link themselves while signed in to their
            own account — passing the link on is fine, but the approval has to be theirs.
          </p>
          <div className="mt-4">
            <Link
              href="/profile?tab=horses"
              className="text-sm font-medium px-3 py-2 rounded border"
              style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
            >
              Back to my horses
            </Link>
          </div>
        </Notice>
      ) : !request ? (
        <Notice tone="error" title="This link isn’t valid">
          <p>
            It may have been mistyped, or the request may have been withdrawn. Ask whoever sent it
            to share a new link.
          </p>
        </Notice>
      ) : (
        <RespondToRequest token={token} request={request} />
      )}
    </main>
  );
}
