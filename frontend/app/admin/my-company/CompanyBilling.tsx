'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import BankVerificationNote from '@/components/payments/BankVerificationNote';
import StripePaymentForm from '@/components/payments/StripePaymentForm';
import { errorMessage } from '@/lib/api-error';
import {
  INVOICE_STATUS_LABEL,
  cardRateLabel,
  formatCents,
  type GaitDeskInvoice,
  type PaymentSetup,
  type SettleUp,
} from '@/lib/payments';

/** `OnlinePaymentsOut`: the company's own Stripe account (migration 172). */
export interface OnlinePayments {
  configured: boolean;
  plan_allows: boolean;
  connected: boolean;
  charges_enabled: boolean;
  details_submitted: boolean;
  /** Stripe is waiting on the company for more details, not checking them. */
  details_due?: boolean;
  pass_card_fees: boolean;
  card_percent_bp: number;
  card_fixed_cents: number;
  card_fee_cap_bp: number;
}

const sectionClass = 'border rounded-lg p-4 space-y-4';
const sectionStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;
const primaryButton = 'text-sm font-medium px-4 py-2 rounded disabled:opacity-50';
const primaryStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } as const;
const secondaryButton = 'text-sm font-medium px-3 py-2 rounded border disabled:opacity-50';
const secondaryStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

function day(value: string | null): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_STYLE: Record<GaitDeskInvoice['status'], { backgroundColor: string; color: string }> = {
  open: { backgroundColor: 'var(--accent-bg)', color: 'var(--accent-hover)' },
  overdue: { backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' },
  processing: { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' },
  paid: { backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' },
  void: { backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' },
};

function Note({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>
      {message.text}
    </p>
  );
}

// ── Invoices from GaitDesk ───────────────────────────────────────────────────

function InvoiceRow({
  companyId,
  invoice,
  canPayOnline,
  autoOpen = false,
}: {
  companyId: string;
  invoice: GaitDeskInvoice;
  canPayOnline: boolean;
  /** Arrived from the invoice email's link: open its payment straight away. */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(autoOpen);
  const [setup, setSetup] = useState<PaymentSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const payable = invoice.status === 'open' || invoice.status === 'overdue';
  const base = `/api/my-company/${companyId}/invoices/${invoice.id}`;

  const startPaying = async () => {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`${base}/payment`, { cache: 'no-store' }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setLoading(false);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(json, 'The payment form could not be loaded. Try again.') });
      return;
    }
    setSetup(json as PaymentSetup);
    setOpen(true);
  };

  // Once, on arrival from the email: scroll to the invoice and, when it can be
  // paid online, open its payment form.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (payable && canPayOnline) void startPaying();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  return (
    <li ref={rowRef} className="py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-semibold hover:underline"
            style={{ color: 'var(--foreground)' }}
          >
            {invoice.label}
          </button>
          <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
            Issued {day(invoice.issued_on)} · due {day(invoice.due_on)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{formatCents(invoice.amount_cents)}</span>
          <span className="text-xs font-medium rounded px-2 py-0.5" style={STATUS_STYLE[invoice.status]}>
            {INVOICE_STATUS_LABEL[invoice.status]}
          </span>
        </div>
      </div>

      {open && (
        <ul className="text-sm space-y-1 pl-3" style={{ color: 'var(--text-deep)' }}>
          {invoice.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-4">
              <span>
                {line.description}
                {line.exhibitor_count !== null && line.rate_cents !== null && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}— {line.exhibitor_count} exhibitors at {formatCents(line.rate_cents)}
                  </span>
                )}
              </span>
              <span>{formatCents(line.amount_cents)}</span>
            </li>
          ))}
          {invoice.note && <li style={{ color: 'var(--muted)' }}>{invoice.note}</li>}
        </ul>
      )}

      {invoice.status === 'paid' && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Paid {day(invoice.paid_on)}
          {invoice.payment_reference ? ` — ${invoice.payment_reference}` : ''}
          {invoice.card_fee_cents > 0 ? `, with a ${formatCents(invoice.card_fee_cents)} card processing fee` : ''}.
        </p>
      )}
      {invoice.status === 'processing' && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Your bank payment is on its way. It takes a few business days to settle, and this invoice shows Paid once it does.
        </p>
      )}

      {payable && !setup && (
        canPayOnline ? (
          <button type="button" onClick={startPaying} disabled={loading} title={loading ? 'Loading…' : undefined} className={secondaryButton} style={secondaryStyle}>
            {loading ? 'Loading…' : 'Pay this invoice'}
          </button>
        ) : (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Pay by check or bank transfer — reply to the invoice email for GaitDesk&apos;s details.
          </p>
        )
      )}

      {payable && setup && (
        <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Pay by bank transfer for {formatCents(invoice.amount_cents)}, or by card. A credit card adds the{' '}
            {cardRateLabel(setup.card_percent_bp, setup.card_fixed_cents)} processing fee, capped at{' '}
            {setup.card_fee_cap_bp / 100}%; a debit card adds nothing.
          </p>
          <StripePaymentForm
            setup={{ ...setup, pass_card_fees: false }}
            amountLabel={`Invoice ${invoice.label}`}
            quoteUrl={`${base}/quote`}
            payUrl={`${base}/pay`}
            statusUrl={`${base}/payment-status`}
            onDone={(status, url) => {
              setSetup(null);
              setVerificationUrl(status === 'processing' ? url ?? null : null);
              setMessage({
                ok: true,
                text:
                  status === 'processing'
                    ? 'Bank payment started. It settles in a few business days.'
                    : 'Paid — thank you. A receipt is on its way by email.',
              });
              router.refresh();
            }}
          />
        </div>
      )}
      <Note message={message} />
      <BankVerificationNote url={verificationUrl} />
    </li>
  );
}

function Invoices({
  companyId,
  invoices,
  canPayOnline,
  openInvoiceId,
}: {
  companyId: string;
  invoices: GaitDeskInvoice[];
  canPayOnline: boolean;
  openInvoiceId: string | null;
}) {
  const owed = invoices.filter((i) => i.status === 'open' || i.status === 'overdue');
  return (
    <section className={sectionClass} style={sectionStyle}>
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Invoices from GaitDesk</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          GaitDesk invoices each show after it runs, and any Pro+ year, net 30. Nothing is ever taken out of your
          exhibitors&apos; payments.
          {owed.length > 0 && (
            <> {owed.length === 1 ? 'One invoice is' : `${owed.length} invoices are`} waiting to be paid.</>
          )}
        </p>
      </div>
      {invoices.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No invoices yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              companyId={companyId}
              invoice={invoice}
              canPayOnline={canPayOnline}
              autoOpen={invoice.id === openInvoiceId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Settling up after a show (migration 173) ─────────────────────────────────

/**
 * The finished shows that stop the company setting up its next one until
 * they are paid. "Get the invoice" issues one for the shows not yet invoiced;
 * it then appears under Invoices to pay by card or bank, which lifts the hold
 * at once — or to pay by check, which GaitDesk marks paid when it arrives.
 */
function SettleUpPanel({ companyId, settleUp, canPayOnline }: { companyId: string; settleUp: SettleUp; canPayOnline: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!settleUp.blocked) return null;

  const getInvoice = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/my-company/${companyId}/settle-up/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(json, 'The invoice could not be issued. Try again.') });
      return;
    }
    setMessage({ ok: true, text: `Invoice ${json.label} is ready below.` });
    router.refresh();
  };

  return (
    <section
      className="border rounded-lg p-4 space-y-3"
      style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
    >
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Settle up to set up your next show</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-deep)' }}>
          These shows have finished and aren&apos;t paid for yet. You can set up another show once they are.
        </p>
      </div>
      <ul className="text-sm space-y-1" style={{ color: 'var(--text-deep)' }}>
        {settleUp.shows.map((show) => (
          <li key={show.show_id} className="flex flex-wrap justify-between gap-2">
            <span>
              <span className="font-medium" style={{ color: 'var(--foreground)' }}>{show.show_name}</span>
              <span style={{ color: 'var(--muted)' }}>
                {' '}— {show.exhibitor_count} exhibitors at {formatCents(show.rate_cents)} ({show.billing_plan_label})
                {show.invoice_label ? ` · on ${show.invoice_label}` : ''}
              </span>
            </span>
            <span className="font-medium tabular-nums">{formatCents(show.amount_cents)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {canPayOnline
          ? 'Pay by card or bank transfer under Invoices and you can carry on straight away. Paying by check? Mail it with the invoice number — GaitDesk marks it paid and unlocks your account when it arrives.'
          : 'Pay by check with the invoice number — GaitDesk marks it paid and unlocks your account when it arrives.'}
      </p>
      {settleUp.can_issue_invoice && (
        <button
          type="button"
          onClick={getInvoice}
          disabled={busy}
          title={busy ? 'Issuing…' : undefined}
          className={primaryButton}
          style={primaryStyle}
        >
          {busy ? 'Issuing…' : 'Get the invoice'}
        </button>
      )}
      <Note message={message} />
    </section>
  );
}

// ── Online payments from exhibitors ──────────────────────────────────────────

function OnlinePaymentsPanel({
  companyId,
  initial,
  stripeReturn,
}: {
  companyId: string;
  initial: OnlinePayments;
  stripeReturn: string | null;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [passFees, setPassFees] = useState(initial.pass_card_fees);
  const [agree, setAgree] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/api/my-company/${companyId}/online-payments`;

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`${base}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !json?.url) {
      setBusy(false);
      setMessage({ ok: false, text: errorMessage(json, 'Stripe could not be reached. Try again in a moment.') });
      return;
    }
    window.location.href = json.url;
  };

  // Stripe sends the manager back to `?stripe=refresh` when its setup link had
  // expired or was already opened (a link preview can open it first). Stripe's
  // advice is to make a new link and send them straight back, so they never
  // have to find the button again.
  const resumed = useRef(false);
  const resume =
    stripeReturn === 'refresh' && state.configured && state.plan_allows && state.connected && !state.charges_enabled;
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass_card_fees: passFees, agree_surcharge_rules: agree }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(json, 'Could not save. Try again.') });
      return;
    }
    setState(json as OnlinePayments);
    setAgree(false);
    setMessage({ ok: true, text: 'Saved.' });
  };

  const rate = cardRateLabel(state.card_percent_bp, state.card_fixed_cents);
  const cap = `${state.card_fee_cap_bp / 100}%`;
  const changed = passFees !== state.pass_card_fees;
  const needsAgreement = passFees && !state.pass_card_fees;

  let body: ReactNode;
  if (!state.configured) {
    body = <p className="text-sm" style={{ color: 'var(--muted)' }}>Online payment isn&apos;t available on GaitDesk yet. Exhibitors pay the show office as they do today.</p>;
  } else if (!state.plan_allows) {
    body = (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Taking exhibitors&apos; payments online is part of GaitDesk Pro. Move to Pro under your plan above to set it up.
      </p>
    );
  } else if (!state.connected || !state.charges_enabled) {
    body = (
      <div className="space-y-3 text-sm" style={{ color: 'var(--text-deep)' }}>
        <p>
          Exhibitors pay their balance from My Shows, straight into your company&apos;s own Stripe account — Stripe pays
          it out to your bank, and GaitDesk never handles the money. Stripe charges your account its processing fee
          (usually {rate} a card); you choose below whether credit card payers cover it.
        </p>
        {state.connected && (
          <p style={{ color: 'var(--warning-strong)' }}>
            {state.details_due
              ? 'Stripe needs a few more details before you can take payments. Continue setting up Stripe to finish.'
              : state.details_submitted
                ? 'Stripe is checking your details. This usually takes a few minutes — refresh to check.'
                : 'Your Stripe account is not finished yet.'}
          </p>
        )}
        <button type="button" onClick={connect} disabled={busy} title={busy ? 'Opening Stripe…' : undefined} className={primaryButton} style={primaryStyle}>
          {busy ? 'Opening Stripe…' : state.connected ? 'Continue setting up Stripe' : 'Connect a Stripe account'}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3 text-sm" style={{ color: 'var(--text-deep)' }}>
        <p style={{ color: 'var(--success-strong)' }}>
          Exhibitors at your shows can pay their balance online. Payments are recorded on each exhibitor&apos;s account
          automatically.
        </p>
        <fieldset className="space-y-2">
          <legend className="font-medium" style={{ color: 'var(--foreground)' }}>Card processing fee</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name={`fees-${companyId}`} checked={!passFees} onChange={() => setPassFees(false)} className="mt-1" />
            <span>Your company absorbs it. Exhibitors pay their balance and nothing more.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name={`fees-${companyId}`} checked={passFees} onChange={() => setPassFees(true)} className="mt-1" />
            <span>
              Credit card payers pay it — the {rate} fee is added to their total, capped at {cap}. Debit cards and bank
              transfers are never charged a fee.
            </span>
          </label>
        </fieldset>
        {needsAgreement && (
          <label className="flex items-start gap-2 rounded border p-3" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span>
              Card surcharges are allowed where my company does business. Some states ban or cap them, and your company is
              the merchant, so check your state&apos;s rules before passing the fee on.
            </span>
          </label>
        )}
        {changed && (
          <button
            type="button"
            onClick={save}
            disabled={busy || (needsAgreement && !agree)}
            title={needsAgreement && !agree ? 'Confirm that surcharges are allowed where you do business' : busy ? 'Saving…' : undefined}
            className={primaryButton}
            style={primaryStyle}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className={sectionClass} style={sectionStyle}>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Online payments from exhibitors</h2>
      {body}
      <Note message={message} />
    </section>
  );
}

export default function CompanyBilling({
  companyId,
  companyName,
  showName,
  invoices,
  online,
  settleUp,
  stripeReturn,
  openInvoiceId = null,
}: {
  companyId: string;
  companyName: string;
  /** Name the company in each heading when the caller works for more than one. */
  showName: boolean;
  invoices: GaitDeskInvoice[];
  online: OnlinePayments | null;
  settleUp: SettleUp | null;
  stripeReturn: string | null;
  /** `?invoice=` from an invoice email: that invoice's payment opens on arrival. */
  openInvoiceId?: string | null;
}) {
  return (
    <div className="space-y-4">
      {showName && (
        <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
          {companyName}: billing
        </h2>
      )}
      {settleUp && <SettleUpPanel companyId={companyId} settleUp={settleUp} canPayOnline={!!online?.configured} />}
      <Invoices companyId={companyId} invoices={invoices} canPayOnline={!!online?.configured} openInvoiceId={openInvoiceId} />
      {online && <OnlinePaymentsPanel companyId={companyId} initial={online} stripeReturn={stripeReturn} />}
    </div>
  );
}
