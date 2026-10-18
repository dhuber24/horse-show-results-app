'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import StripePaymentForm from '@/components/payments/StripePaymentForm';
import { errorMessage } from '@/lib/api-error';
import { cardRateLabel, formatCents, type PaymentSetup } from '@/lib/payments';

/** `ProPlusOfferOut` (migration 173). */
interface ProPlusOffer {
  price_cents: number;
  starts_on: string;
  ends_on: string;
  can_buy_online: boolean;
  pending: boolean;
}

function day(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Buy a year of GaitDesk Pro+ on My Company (migration 173). Pro+ is paid for
 * up front: by bank transfer for the price, or by credit card with the
 * processing fee added, and the year starts once the payment succeeds. The
 * year it buys — from today, or from the day after the current one ends — and
 * the price are the backend's; nothing here works either out.
 *
 * Returns null while online payment is not set up: the caller then offers its
 * "Ask about Pro+" fallback instead.
 */
export default function BuyProPlus({
  companyId,
  label = 'Buy Pro+',
  onUnavailable,
}: {
  companyId: string;
  label?: string;
  /** Told when online payment is not set up, so the caller can offer something else. */
  onUnavailable?: () => void;
}) {
  const router = useRouter();
  const [offer, setOffer] = useState<ProPlusOffer | null>(null);
  const [setup, setSetup] = useState<PaymentSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'succeeded' | 'processing' | null>(null);
  const base = `/api/my-company/${companyId}/pro-plus`;

  const start = async () => {
    setBusy(true);
    setError(null);
    const offerRes = await fetch(base, { cache: 'no-store' }).catch(() => null);
    const offerBody = offerRes ? await offerRes.json().catch(() => null) : null;
    if (!offerRes?.ok) {
      setBusy(false);
      setError(errorMessage(offerBody, 'Pro+ could not be loaded. Try again.'));
      return;
    }
    const loaded = offerBody as ProPlusOffer;
    if (!loaded.can_buy_online) {
      setBusy(false);
      onUnavailable?.();
      setError('Buying Pro+ online isn’t available yet. Ask GaitDesk about Pro+ instead.');
      return;
    }
    const setupRes = await fetch(`${base}/payment`, { cache: 'no-store' }).catch(() => null);
    const setupBody = setupRes ? await setupRes.json().catch(() => null) : null;
    setBusy(false);
    if (!setupRes?.ok) {
      setError(errorMessage(setupBody, 'The payment form could not be loaded. Try again.'));
      return;
    }
    setOffer(loaded);
    setSetup(setupBody as PaymentSetup);
  };

  if (done) {
    return (
      <p role="status" className="text-sm" style={{ color: 'var(--success-strong)' }}>
        {done === 'processing'
          ? 'Bank payment started. Your Pro+ year starts when it settles, usually in a few business days.'
          : 'Payment received — your Pro+ year has started. A receipt and confirmation are on their way by email.'}
      </p>
    );
  }

  if (offer && setup) {
    return (
      <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
          <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
            GaitDesk Pro+, {day(offer.starts_on)} to {day(offer.ends_on)}: {formatCents(offer.price_cents)}
          </span>
          . Pay by bank transfer for that amount, or by card — a credit card adds the{' '}
          {cardRateLabel(setup.card_percent_bp, setup.card_fixed_cents)} processing fee, capped at{' '}
          {setup.card_fee_cap_bp / 100}%; a debit card adds nothing.
        </p>
        <StripePaymentForm
          setup={{ ...setup, pass_card_fees: false }}
          amountLabel="GaitDesk Pro+, one year"
          quoteUrl={`${base}/quote`}
          payUrl={`${base}/pay`}
          statusUrl={`${base}/payment-status`}
          onDone={(status) => {
            setDone(status);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        title={busy ? 'Loading…' : undefined}
        className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
      >
        {busy ? 'Loading…' : label}
      </button>
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
