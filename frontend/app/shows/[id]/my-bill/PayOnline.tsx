'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import StripePaymentForm from '@/components/payments/StripePaymentForm';
import { formatCents, type PaymentSetup } from '@/lib/payments';

/**
 * Pay the balance at this show online (migration 172), to the show company's
 * own Stripe account. The balance is the office's own figure — what is billed
 * less what has already been recorded — so it can be less than the bill above.
 * Shown only when the backend says the show takes payments online.
 */
export default function PayOnline({
  showId,
  companyName,
  balanceCents,
  setup,
  justPaid,
}: {
  showId: string;
  companyName: string | null;
  balanceCents: number;
  setup: PaymentSetup;
  justPaid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<'succeeded' | 'processing' | null>(justPaid ? 'succeeded' : null);
  const base = `/api/my-shows/${showId}/payment`;

  if (done) {
    return (
      <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--text-deep)' }}>
        <p className="font-semibold" style={{ color: 'var(--success-strong)' }}>
          {done === 'processing' ? 'Bank payment started.' : 'Payment received — thank you.'}
        </p>
        <p className="mt-1">
          {done === 'processing'
            ? 'It takes a few business days to settle, and shows on your account once it does.'
            : 'A receipt is on its way by email, and the show office sees the payment on your account.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Balance due: {formatCents(balanceCents)}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            After the payments the show office has recorded. Paid straight to {companyName ?? 'the show'}.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium px-4 py-2 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Pay online
          </button>
        )}
      </div>
      {open && (
        <StripePaymentForm
          setup={setup}
          amountLabel="Balance at this show"
          quoteUrl={`${base}/quote`}
          payUrl={base}
          statusUrl={`${base}/status`}
          onDone={(status) => {
            setDone(status);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
