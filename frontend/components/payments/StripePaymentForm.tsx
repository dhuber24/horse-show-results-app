'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { errorMessage } from '@/lib/api-error';
import {
  cardFeeNotice,
  formatCents,
  quoteMethodLabel,
  type PaymentQuote,
  type PaymentResult,
  type PaymentSetup,
} from '@/lib/payments';

/**
 * One online payment, confirmed on the server (migration 172).
 *
 * Stripe's form collects the card or bank details; nothing is charged until
 * the payer has seen the total. "Review payment" turns what was entered into a
 * ConfirmationToken and asks the backend to quote it — the backend reads off
 * the token whether this is a credit card, and adds the processing fee only
 * then, and only where the payee passes it on. "Pay" charges exactly that
 * total. A change to the details after the quote throws the quote away.
 *
 * Used for a show company paying its GaitDesk invoice (on GaitDesk's account)
 * and an exhibitor paying a show company (on the company's own account, which
 * is what `setup.stripe_account` names).
 */
export interface StripePaymentFormProps {
  setup: PaymentSetup;
  /** What is being paid, for the summary: "Balance at Spring Fling". */
  amountLabel: string;
  quoteUrl: string;
  payUrl: string;
  /** POST { payment_intent_id } after the bank asked the payer to confirm. */
  statusUrl: string;
  onDone: (status: 'succeeded' | 'processing') => void;
}

const stripeCache = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string, account: string | null): Promise<Stripe | null> {
  const key = `${publishableKey}:${account ?? ''}`;
  let promise = stripeCache.get(key);
  if (!promise) {
    promise = loadStripe(publishableKey, account ? { stripeAccount: account } : undefined);
    stripeCache.set(key, promise);
  }
  return promise;
}

/**
 * Stripe draws its form in an iframe, which cannot read this page's CSS
 * custom properties — so the app's own tokens are read off the document and
 * handed over as values. No colour is written here.
 */
function useStripeAppearance(): Appearance | undefined {
  const [appearance, setAppearance] = useState<Appearance | undefined>(undefined);
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim() || undefined;
    setAppearance({
      theme: 'stripe',
      variables: {
        colorPrimary: token('--accent'),
        colorBackground: token('--surface'),
        colorText: token('--foreground'),
        colorDanger: token('--error-strong'),
        borderRadius: '6px',
      },
    });
  }, []);
  return appearance;
}

const primaryButton = 'text-sm font-medium px-4 py-2 rounded disabled:opacity-50';
const primaryStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } as const;
const secondaryButton = 'text-sm font-medium px-3 py-2 rounded border disabled:opacity-50';
const secondaryStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

async function postJson(url: string, body: object): Promise<{ ok: boolean; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = res ? await res.json().catch(() => null) : null;
  return { ok: !!res?.ok, json };
}

function PaymentSteps({ setup, amountLabel, quoteUrl, payUrl, statusUrl, onDone }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const notice = cardFeeNotice(setup);

  const review = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const submitted = await elements.submit();
    if (submitted.error) {
      setBusy(false);
      setError(submitted.error.message ?? 'Check the payment details.');
      return;
    }
    const created = await stripe.createConfirmationToken({
      elements,
      params: { return_url: window.location.href },
    });
    if (created.error || !created.confirmationToken) {
      setBusy(false);
      setError(created.error?.message ?? 'Check the payment details.');
      return;
    }
    const { ok, json } = await postJson(quoteUrl, { confirmation_token: created.confirmationToken.id });
    setBusy(false);
    if (!ok) {
      setError(errorMessage(json, 'Could not work out the total. Try again.'));
      return;
    }
    const quoted = json as PaymentQuote;
    // The form shows the amount to wallets such as Apple Pay; keep it the total.
    elements.update({ amount: quoted.total_cents });
    setToken(created.confirmationToken.id);
    setQuote(quoted);
  };

  const pay = async () => {
    if (!stripe || !token || !quote) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await postJson(payUrl, {
      confirmation_token: token,
      expected_total_cents: quote.total_cents,
    });
    // A ConfirmationToken is spent once used, so any outcome but success
    // starts again from Review.
    setToken(null);
    if (!ok) {
      setBusy(false);
      setQuote(null);
      setError(errorMessage(json, 'The payment did not go through. Nothing was charged.'));
      return;
    }
    const result = json as PaymentResult;
    if (result.status === 'requires_action' && result.client_secret) {
      const action = await stripe.handleNextAction({ clientSecret: result.client_secret });
      if (action.error) {
        setBusy(false);
        setQuote(null);
        setError(action.error.message ?? 'Your bank did not confirm the payment. Nothing was charged.');
        return;
      }
      // Records it now rather than waiting on the webhook. Either way the page
      // that `onDone` refreshes reads where the payment really stands.
      const status = await postJson(statusUrl, { payment_intent_id: result.payment_intent_id });
      setBusy(false);
      onDone(status.json?.status === 'processing' ? 'processing' : 'succeeded');
      return;
    }
    setBusy(false);
    if (result.status === 'succeeded' || result.status === 'processing') {
      onDone(result.status);
      return;
    }
    setQuote(null);
    setError('The payment did not go through. Nothing was charged.');
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {notice}
        </p>
      )}
      <PaymentElement
        onChange={() => {
          if (quote) {
            setQuote(null);
            setToken(null);
          }
        }}
      />
      {quote ? (
        <div className="rounded border p-3 text-sm space-y-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
          <div className="flex justify-between gap-4">
            <span style={{ color: 'var(--text-deep)' }}>{amountLabel}</span>
            <span style={{ color: 'var(--foreground)' }}>{formatCents(quote.amount_cents)}</span>
          </div>
          {quote.card_fee_cents > 0 && (
            <div className="flex justify-between gap-4">
              <span style={{ color: 'var(--text-deep)' }}>Card processing fee (credit card)</span>
              <span style={{ color: 'var(--foreground)' }}>{formatCents(quote.card_fee_cents)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 font-semibold pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--foreground)' }}>Total by {quoteMethodLabel(quote)}</span>
            <span style={{ color: 'var(--foreground)' }}>{formatCents(quote.total_cents)}</span>
          </div>
        </div>
      ) : null}
      {error && (
        <p className="text-sm" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {quote ? (
          <>
            <button type="button" onClick={pay} disabled={busy || !stripe} title={busy ? 'Paying…' : undefined} className={primaryButton} style={primaryStyle}>
              {busy ? 'Paying…' : `Pay ${formatCents(quote.total_cents)}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuote(null);
                setToken(null);
              }}
              disabled={busy}
              title={busy ? 'Paying…' : undefined}
              className={secondaryButton}
              style={secondaryStyle}
            >
              Change payment details
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={review}
            disabled={busy || !stripe || !elements}
            title={!stripe ? 'Loading the payment form…' : busy ? 'Working out the total…' : undefined}
            className={primaryButton}
            style={primaryStyle}
          >
            {busy ? 'Working out the total…' : 'Review payment'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function StripePaymentForm(props: StripePaymentFormProps) {
  const { setup } = props;
  const stripePromise = useMemo(
    () => stripeFor(setup.publishable_key, setup.stripe_account),
    [setup.publishable_key, setup.stripe_account],
  );
  const appearance = useStripeAppearance();
  if (!appearance) return null;
  return (
    <Elements
      stripe={stripePromise}
      options={{ mode: 'payment', amount: setup.amount_cents, currency: 'usd', appearance }}
    >
      <PaymentSteps {...props} />
    </Elements>
  );
}
