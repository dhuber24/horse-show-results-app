/**
 * Online payments through Stripe (migration 172): the shapes the payment
 * screens read, and the words they use about the card fee.
 *
 * Nothing here works out what anybody is charged. The backend quotes every
 * total (`billing.payment_quote`) from the card the payer actually entered —
 * whether a fee applies depends on the card being credit rather than debit,
 * which only the server is told reliably. These helpers only describe it.
 */

/** `PaymentSetupOut`: what the payment form needs for one payment. */
export interface PaymentSetup {
  publishable_key: string;
  /** Set when the payment goes to a show company's own Stripe account. */
  stripe_account: string | null;
  amount_cents: number;
  pass_card_fees: boolean;
  card_percent_bp: number;
  card_fixed_cents: number;
  card_fee_cap_bp: number;
}

/** `PaymentQuoteOut`. */
export interface PaymentQuote {
  amount_cents: number;
  card_fee_cents: number;
  total_cents: number;
  method_type: string | null;
  card_funding: string | null;
}

/** `PaymentResultOut`. */
export interface PaymentResult {
  status: string;
  payment_intent_id: string;
  client_secret: string | null;
  total_cents: number;
  /** A bank account typed in by hand waits on a microdeposit (status
   *  `processing`): Stripe's page where the payer enters it. */
  verification_url?: string | null;
}

/** `GaitDeskInvoiceOut`. */
export interface GaitDeskInvoice {
  id: string;
  number: number;
  label: string;
  company_id: string | null;
  company_name: string;
  issued_on: string;
  due_on: string;
  amount_cents: number;
  status: 'open' | 'overdue' | 'processing' | 'paid' | 'void';
  note: string | null;
  paid_on: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  card_fee_cents: number;
  voided_at: string | null;
  lines: {
    id: string;
    kind: 'show' | 'pro_plus';
    show_id: string | null;
    subscription_id: string | null;
    description: string;
    exhibitor_count: number | null;
    rate_cents: number | null;
    amount_cents: number;
  }[];
}

/** `SettleUpOut` (migration 173): the finished shows a company must pay for
 * before it sets up another, and whether it can have them invoiced now. */
export interface SettleUp {
  blocked: boolean;
  message: string | null;
  shows: {
    show_id: string;
    show_name: string;
    end_date: string | null;
    exhibitor_count: number;
    rate_cents: number;
    amount_cents: number;
    billing_plan_label: string;
    invoice_id: string | null;
    invoice_label: string | null;
  }[];
  can_issue_invoice: boolean;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "2.9% + 30¢" */
export function cardRateLabel(percentBp: number, fixedCents: number): string {
  const percent = `${(percentBp / 100).toFixed(percentBp % 100 === 0 ? 0 : percentBp % 10 === 0 ? 1 : 2)}%`;
  return fixedCents > 0 ? `${percent} + ${fixedCents}¢` : percent;
}

/** The sentence a payment form shows before anything is typed. */
export function cardFeeNotice(setup: Pick<PaymentSetup, 'pass_card_fees' | 'card_fee_cap_bp'>): string | null {
  if (!setup.pass_card_fees) return null;
  const cap = `${setup.card_fee_cap_bp / 100}%`;
  return `Paying by credit card adds a card processing fee of up to ${cap}. Debit cards and bank transfers add nothing.`;
}

/** "Paid by Visa ending 4242" style label for a quote. */
export function quoteMethodLabel(quote: PaymentQuote): string {
  if (quote.method_type === 'card') {
    const funding = quote.card_funding && quote.card_funding !== 'unknown' ? `${quote.card_funding} card` : 'card';
    return funding;
  }
  if (quote.method_type === 'us_bank_account') return 'bank transfer';
  return quote.method_type ?? 'payment';
}

export const INVOICE_STATUS_LABEL: Record<GaitDeskInvoice['status'], string> = {
  open: 'Due',
  overdue: 'Overdue',
  processing: 'Bank payment on its way',
  paid: 'Paid',
  void: 'Cancelled',
};
