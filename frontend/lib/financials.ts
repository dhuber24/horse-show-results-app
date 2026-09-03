/**
 * Shapes for `GET /shows/{id}/financials` and the reporting module.
 *
 * `Bill` is imported from `my-shows` rather than restated: the whole point of
 * computing money in `backend/billing.py` is that the exhibitor's own bill and
 * the office's view of it are the same object, and a second local copy of the
 * type is how that stops being true.
 */
import type { Bill } from './my-shows';

export type { Bill };
export { formatMoney } from './my-shows';

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  transfer: 'Transfer',
  other: 'Other',
};

export type ShowPayment = {
  id: string;
  show_entry_id: string;
  /** Signed — a negative amount is a refund paid back out. */
  amount_cents: number;
  method: PaymentMethod;
  reference: string | null;
  received_on: string;
  note: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string | null;
};

export type FinancialAccount = {
  exhibitor_id: string;
  exhibitor_name: string;
  show_entry_id: string | null;
  back_number: number | null;
  /** False for the shell roster row a secretary creates when adding a late
   *  entry by hand. Those accounts still owe money and are still listed. */
  signed_up: boolean;
  registered_at: string | null;
  entry_count: number;
  horse_count: number;
  bill: Bill;
  collected_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  /** Positive means they owe the show; negative means they have overpaid. */
  balance_cents: number;
  payments: ShowPayment[];
};

export type FinancialFeeLine = {
  show_fee_id: string;
  code: string;
  label: string;
  unit: string;
  quantity: number;
  line_total_cents: number;
  early_rate_quantity: number;
};

/**
 * What one of the show's automatic charges has billed across the show.
 *
 * Kept apart from `FinancialFeeLine` rather than folded in: both are `show_fees`
 * rows, but the Stalls, Shavings & Camping report reads that list as "what
 * exhibitors booked" and foots it against `reservation_total_cents`.
 */
export type FinancialChargeLine = {
  show_fee_id: string;
  code: string;
  label: string;
  unit: string;
  amount_cents: number;
  quantity: number;
  line_total_cents: number;
  /** How many exhibitors carried this charge. */
  exhibitors: number;
};

export type FinancialTotals = {
  accounts: number;
  class_fee_total_cents: number;
  sanction_total_cents: number;
  reservation_total_cents: number;
  charge_total_cents: number;
  billed_cents: number;
  collected_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  /** Sum of what is owed, ignoring overpayments — never netted against
   *  `credit_cents`, so one exhibitor paying twice cannot make the show's
   *  arrears look smaller than they are. */
  outstanding_cents: number;
  credit_cents: number;
  net_balance_cents: number;
  accounts_outstanding: number;
  accounts_paid_in_full: number;
  accounts_unpaid: number;
  fee_lines: FinancialFeeLine[];
  charge_lines: FinancialChargeLine[];
};

export type FinancialRegistrations = {
  exhibitors: number;
  signed_up: number;
  staff_added: number;
  entries: number;
  horses: number;
  classes: number;
  classes_with_entries: number;
};

export type FinancialSidePot = {
  side_pot_id: string;
  name: string;
  status: string;
  entry_fee_cents: number;
  payback_percent: number;
  entry_count: number;
  paid_count: number;
  buy_ins_cents: number;
  payout_pool_cents: number;
  paid_out_cents: number;
  retained_cents: number;
};

export type ShowFinancials = {
  show_id: string;
  show_name: string;
  show_status: string;
  currency: string;
  totals: FinancialTotals;
  registrations: FinancialRegistrations;
  accounts: FinancialAccount[];
  /** Reported apart from the accounts on purpose — pot buy-ins are not part of
   *  `build_bill`, so folding them into a balance would make this screen
   *  disagree with the bill the exhibitor sees on My Shows. */
  side_pots: FinancialSidePot[];
  side_pot_buy_ins_cents: number;
  side_pot_paid_out_cents: number;
  side_pot_retained_cents: number;
};

// ── Reports ──────────────────────────────────────────────────────────────────

// The report shape moved to `lib/reports.ts` when a second backend registry
// started producing them — `show_reports.py`, which is not about money. These
// re-exports keep every existing import working.
export {
  REPORT_ICONS,
  formatReportCell,
  reportIcon,
  type Report,
  type ReportColumn,
  type ReportDefinition,
} from './reports';

export function formatReceivedOn(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
