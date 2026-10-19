import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { PaymentSetup } from '@/lib/payments';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import ShowHubHeader from '../_components/ShowHubHeader';
import DueAtShow from '../_components/DueAtShow';
import { loadMyShowBill } from '../_components/myShowBill';
import PayOnline from './PayOnline';

/** `ShowPaymentAvailabilityOut` (migration 172). */
interface PaymentAvailability {
  available: boolean;
  reason: string | null;
  balance_cents: number;
  company_name: string | null;
  setup: PaymentSetup | null;
  /** Migration 174: a bank payment of theirs is on its way; nothing more is
   *  offered until it settles or fails. */
  bank_payment_pending?: boolean;
}

async function loadPaymentAvailability(showId: string): Promise<PaymentAvailability | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/my-shows/${showId}/payment`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  return (await readJsonBody(res)) as PaymentAvailability | null;
}

/**
 * What this one show costs the signed-in exhibitor, itemised.
 *
 * Reached from the **What I Owe** tile on the show menu. `loadMyShowBill()`
 * reads `GET /my-shows/` and picks this show out of it, so the figure here is
 * byte-for-byte the one on My Shows — a second endpoint summing the same fees
 * would be faster and would eventually disagree.
 */

export default async function MyShowBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const session = await auth();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/shows/${id}/my-bill`)}`);

  const [show, mine, payment] = await Promise.all([fetchShow(id), loadMyShowBill(id), loadPaymentAvailability(id)]);
  const payOnline = payment?.available && payment.setup ? payment : null;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>What I owe</h2>

      {!mine ? (
        <div
          className="rounded-lg border p-5 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}
        >
          <p className="font-medium" style={{ color: 'var(--foreground)' }}>Nothing on your account here.</p>
          <p className="mt-1">
            You haven&rsquo;t signed up for this show or been entered in any classes, so there is
            nothing to bill yet.
          </p>
          {show.status === 'PUBLISHED' && (
            <div className="mt-3">
              <Link
                href={`/shows/${id}/signup`}
                className="inline-block text-sm font-medium px-4 py-2 rounded text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Sign up for this show →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <DueAtShow show={mine} />
          </div>

          <div
            className="rounded-lg border p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <ShowBillBreakdown bill={mine.bill} detailed />
          </div>

          {/* Side pot buy-ins are on the bill above: entering a class a pot
              bundles is the buy-in, so `build_bill` charges it and the office's
              Financials reads the same figure. See Claude.md. */}
          {payment?.bank_payment_pending ? (
            <p className="text-sm mt-4 rounded border p-3" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}>
              {payment.reason}
            </p>
          ) : (
            !payOnline && paid === '1' && (
              <p className="text-sm mt-4" style={{ color: 'var(--success-strong)' }}>
                Payment received — thank you. It shows on your account once the show office&rsquo;s records catch up.
              </p>
            )
          )}
          {payOnline && payOnline.setup && (
            <div className="mt-4">
              <PayOnline
                showId={id}
                companyName={payOnline.company_name}
                balanceCents={payOnline.balance_cents}
                setup={payOnline.setup}
                justPaid={paid === '1'}
              />
            </div>
          )}

          <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
            {payOnline
              ? 'Pay online above, or pay the show office as usual. If a number looks wrong, the show secretary is the one who can change it.'
              : 'This is what the show office will collect. If a number looks wrong, the show secretary is the one who can change it.'}
          </p>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href={`/shows/${id}/register/classes`} className="hover:underline" style={{ color: 'var(--accent)' }}>
          My classes →
        </Link>
        <Link href={`/shows/${id}/register`} className="hover:underline" style={{ color: 'var(--accent)' }}>
          My registration →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: 'var(--accent)' }}>
          Query this with the show office →
        </Link>
        <Link href="/my-shows" className="hover:underline" style={{ color: 'var(--accent)' }}>
          All my shows →
        </Link>
      </div>
    </main>
  );
}
