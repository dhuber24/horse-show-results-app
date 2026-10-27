'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import {
  daysUntil,
  formatDay,
  PRO_PRICES,
  proPlanLabel,
  type ProPlan,
  type RegistryOptions,
} from '@/lib/trainer-registry';
import PlanMatrix from '@/app/trainers/_components/PlanMatrix';

/** `TrainerProfileOut` — the parts this page reads. */
export interface MyListing {
  id: string;
  is_public: boolean;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  disciplines: string[];
  is_pro: boolean;
  pro_until: string | null;
  pro_plan: ProPlan | null;
  pro_request_plan: ProPlan | null;
  pro_requested_at: string | null;
  /** A Stripe subscription is paying for Pro (migration 172). */
  subscribed: boolean;
  /** Online payment is set up. Without it Pro is asked for, as before. */
  can_subscribe: boolean;
}

// A Pro subscription close to its end is offered for renewal this far ahead.
const RENEW_WITHIN_DAYS = 30;

const primaryButton = 'text-sm font-medium px-4 py-2 rounded disabled:opacity-50';
const primaryStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } as const;
const secondaryButton = 'text-sm font-medium px-3 py-2 rounded border disabled:opacity-50';
const secondaryStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>{message.text}</p>
  );
}

// ── Your plan ────────────────────────────────────────────────────────────────

/**
 * Pro paid by card (migration 172): Subscribe sends the trainer to Stripe
 * Checkout, Manage subscription to Stripe's own page for changing the card,
 * switching plan or cancelling. Pro switches on when Stripe reports the
 * payment, so the page coming back from Checkout may still say Basic for a
 * moment — `justPaid` says so instead of leaving it to look like a failure.
 */
function SubscribeActions({ listing, justPaid }: { listing: MyListing; justPaid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const go = async (path: string, body?: object) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !json?.url) {
      setBusy(false);
      setMessage({ ok: false, text: errorMessage(json, 'Something went wrong. Try again in a moment.') });
      return;
    }
    window.location.href = json.url;
  };

  return (
    <div className="space-y-2">
      {justPaid && !listing.is_pro && (
        <p style={{ color: 'var(--success-strong)' }}>
          Thanks — your payment is being confirmed. Pro switches on in a minute or two; refresh to see it.
        </p>
      )}
      {listing.subscribed ? (
        <>
          <p>Your Pro subscription renews automatically. Change your card, switch plans or cancel on the subscription page.</p>
          <button
            type="button"
            disabled={busy}
            title={busy ? 'Opening…' : undefined}
            onClick={() => go('/api/trainers/me/billing-portal')}
            className={secondaryButton}
            style={secondaryStyle}
          >
            Manage subscription
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(['monthly', 'annual'] as ProPlan[]).map((plan) => (
              <button
                key={plan}
                type="button"
                disabled={busy}
                title={busy ? 'Opening checkout…' : undefined}
                onClick={() => go('/api/trainers/me/pro-checkout', { plan })}
                className={plan === 'monthly' ? primaryButton : secondaryButton}
                style={plan === 'monthly' ? primaryStyle : secondaryStyle}
              >
                {listing.is_pro ? 'Subscribe' : 'Upgrade to Pro'} — {proPlanLabel(plan)}
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Paid by card through Stripe. Yearly is {PRO_PRICES.annual.price} charged once, up front, for the whole
            year — not monthly. Cancel any time — Pro stays on through the time you&apos;ve paid for.
          </p>
        </>
      )}
      <Message message={message} />
    </div>
  );
}

/** The plan's state and the buttons that change it — here, and on a new trainer's `/welcome`. */
export function PlanActions({ listing, justPaid = false }: { listing: MyListing; justPaid?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (method: 'POST' | 'DELETE', plan?: ProPlan) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/trainers/me/pro-request', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ plan }) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setMessage({ ok: false, text: errorMessage(body, 'Something went wrong. Try again in a moment.') });
      return;
    }
    setMessage({
      ok: true,
      text: method === 'POST' ? 'Request sent. GaitDesk will be in touch to arrange payment.' : 'Request withdrawn.',
    });
    router.refresh();
  };

  const upgradeButtons = (verb: string) => (
    <div className="flex flex-wrap gap-2">
      {(['monthly', 'annual'] as ProPlan[]).map((plan) => (
        <button
          key={plan}
          type="button"
          disabled={busy}
          title={busy ? 'Sending…' : undefined}
          onClick={() => send('POST', plan)}
          className={plan === 'monthly' ? primaryButton : secondaryButton}
          style={plan === 'monthly' ? primaryStyle : secondaryStyle}
        >
          {verb} — {proPlanLabel(plan)}
        </button>
      ))}
    </div>
  );

  const left = daysUntil(listing.pro_until);
  const requested = listing.pro_request_plan;

  return (
    <div className="space-y-3 text-sm" style={{ color: 'var(--text-deep)' }}>
      {listing.is_pro ? (
        <p>
          <span className="font-semibold" style={{ color: 'var(--foreground)' }}>You&apos;re on Pro</span>
          {listing.pro_plan ? ` (${listing.pro_plan === 'annual' ? 'yearly' : 'monthly'})` : ''} through{' '}
          {formatDay(listing.pro_until)}. After that your listing goes back to Basic until you renew.
        </p>
      ) : listing.pro_until ? (
        <p>Your Pro ran through {formatDay(listing.pro_until)}, so your listing is on Basic now. Everything you added is kept for when you renew.</p>
      ) : (
        <p>You&apos;re on <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Basic</span>, free.</p>
      )}

      {listing.can_subscribe ? (
        <SubscribeActions listing={listing} justPaid={justPaid} />
      ) : requested ? (
        <div className="space-y-2">
          <p>
            You asked for Pro, {requested === 'annual' ? 'yearly' : 'monthly'} ({proPlanLabel(requested)})
            {listing.pro_requested_at && (
              <>
                {' '}on <LocalTime iso={listing.pro_requested_at} format={{ month: 'short', day: 'numeric' }} />
              </>
            )}
            . GaitDesk will be in touch to arrange payment, and your listing switches to Pro once it&apos;s set up.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Sending…' : undefined}
              onClick={() => send('POST', requested === 'annual' ? 'monthly' : 'annual')}
              className={secondaryButton}
              style={secondaryStyle}
            >
              Switch to {requested === 'annual' ? 'monthly' : 'yearly'}
            </button>
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Sending…' : undefined}
              onClick={() => send('DELETE')}
              className={secondaryButton}
              style={{ ...secondaryStyle, color: 'var(--error-strong)' }}
            >
              Withdraw request
            </button>
          </div>
        </div>
      ) : !listing.is_pro ? (
        upgradeButtons('Upgrade to Pro')
      ) : left !== null && left <= RENEW_WITHIN_DAYS ? (
        <>
          <p>Your Pro ends in {left} day{left === 1 ? '' : 's'}.</p>
          {upgradeButtons('Renew')}
        </>
      ) : null}

      <Message message={message} />
      {!listing.is_public && !listing.is_pro && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Pro only shows once you&apos;re listed — turn the listing on under My Account.</p>
      )}
    </div>
  );
}

/**
 * A trainer's plan: the comparison, the plan they are on and the buttons that
 * change it. The Pro profile and the messages have pages of their own
 * (`pro-profile/`, `messages/`), so the plan is chosen apart from both.
 */
export default function RegistryManager({
  listing,
  options,
  justPaid = false,
}: {
  listing: MyListing;
  options: RegistryOptions;
  /** Back from Stripe Checkout (`?pro=thanks`). */
  justPaid?: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Your plan</h2>
      <PlanMatrix limits={options} current={listing.is_pro ? 'pro' : 'basic'} proAction={<PlanActions listing={listing} justPaid={justPaid} />} />
    </section>
  );
}
