import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import { formatMoney, type MyShowsData, type MyShow } from '@/lib/my-shows';
import ShowHubHeader from '../_components/ShowHubHeader';

/**
 * What this one show costs the signed-in exhibitor.
 *
 * Reads `GET /my-shows/` and picks this show out of it rather than asking for
 * a per-show total. That is one extra row or two over the wire and buys the
 * thing that matters: the number here is byte-for-byte the number on My Shows,
 * because it is the same payload. A second endpoint summing the same fees
 * would be faster and would eventually disagree — the same argument
 * `billing.build_bill` exists to settle (see Claude.md).
 */
async function loadShowBill(showId: string): Promise<MyShow | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/my-shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const data: MyShowsData = await res.json();
  return data.shows.find((s) => s.show_id === showId) ?? null;
}

export default async function MyShowBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/shows/${id}/my-bill`)}`);

  const [show, mine] = await Promise.all([fetchShow(id), loadShowBill(id)]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>What I owe</h2>

      {!mine ? (
        <div
          className="rounded-lg border p-5 text-sm"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2', color: '#5d4a37' }}
        >
          <p className="font-medium" style={{ color: '#2c1810' }}>Nothing on your account here.</p>
          <p className="mt-1">
            You haven&rsquo;t signed up for this show or been entered in any classes, so there is
            nothing to bill yet.
          </p>
          {show.status === 'PUBLISHED' && (
            <div className="mt-3">
              <Link
                href={`/shows/${id}/signup`}
                className="inline-block text-sm font-medium px-4 py-2 rounded text-white"
                style={{ backgroundColor: '#8b4513' }}
              >
                Sign up for this show →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="rounded-lg border px-4 py-3 mb-4 flex items-center justify-between gap-3"
            style={{ borderColor: '#d4b896', backgroundColor: '#faf4ec' }}
          >
            <div className="text-sm" style={{ color: '#5d4a37' }}>
              Due at this show
              <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                {mine.back_number != null ? `Back #${mine.back_number}` : 'No back # yet'}
                {' · '}
                {mine.entry_count} class{mine.entry_count === 1 ? '' : 'es'}
              </div>
            </div>
            <div className="text-2xl font-bold" style={{ color: '#2c1810' }}>
              {formatMoney(mine.bill.total_cents)}
            </div>
          </div>

          <div
            className="rounded-lg border p-4"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <ShowBillBreakdown bill={mine.bill} detailed />
          </div>

          {/* Side pot buy-ins are deliberately absent: they are not part of
              build_bill, and folding them in here would make this page and the
              show office's Financials screen disagree. See Claude.md. */}
          <p className="text-xs mt-4" style={{ color: '#8b7355' }}>
            This is what the show office will collect — the app does not take payment, and any side
            pot buy-ins are settled separately with the office. If a number looks wrong, the show
            secretary is the one who can change it.
          </p>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href={`/shows/${id}/register`} className="hover:underline" style={{ color: '#8b4513' }}>
          My registration →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: '#8b4513' }}>
          Query this with the show office →
        </Link>
        <Link href="/my-shows" className="hover:underline" style={{ color: '#8b4513' }}>
          All my shows →
        </Link>
      </div>
    </main>
  );
}
