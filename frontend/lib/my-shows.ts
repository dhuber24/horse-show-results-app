/**
 * Shared shape of `GET /my-shows`, used by the My Shows page and the Show
 * History tab on the profile. Both read the same payload so a bill can't say
 * one thing in one place and something else in the other.
 */

/**
 * `GET /my-shows/{show_id}` — where the signed-in user stands at one show.
 *
 * Separate from `MyShow` on purpose: this one is answered for *anyone* signed
 * in, including staff and exhibitors with no standing at the show, so every
 * field has a meaningful "nothing here" value and the caller never has to
 * branch on a missing record.
 */
export type MyShowStanding = {
  show_id: string;
  /** True only when sign-up was actually completed. A `show_entries` row with
   *  no `registered_at` is the shell a secretary creates when adding a late
   *  entry by hand — the office has no stall numbers, so it does not count. */
  signed_up: boolean;
  registered_at: string | null;
  back_number: number | null;
  entry_count: number;
  arrival_date: string | null;
  departure_date: string | null;
};

export type BillClassLine = {
  entry_id: string;
  class_id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  horse_name: string | null;
  fee_cents: number;
  nsba_sanction_cents: number;
};

export type BillReservationLine = {
  show_fee_id: string;
  code: string;
  label: string;
  unit: string;
  quantity: number;
  /** The rate actually charged — the early rate when this line was booked
   *  before the fee's deadline, otherwise the standard rate. */
  amount_cents: number;
  standard_amount_cents: number;
  is_early_rate: boolean;
  reserved_at: string;
  line_total_cents: number;
};

export type Bill = {
  class_lines: BillClassLine[];
  reservation_lines: BillReservationLine[];
  class_fee_total_cents: number;
  nsba_sanction_total_cents: number;
  office_charge_cents: number;
  office_charge_basis: string;
  office_charge_total_cents: number;
  reservation_total_cents: number;
  total_cents: number;
};

export type MyShow = {
  show_id: string;
  show_name: string;
  show_status: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  back_number: number | null;
  registered_at: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  notes: string | null;
  entry_count: number;
  placed_count: number;
  best_place: number | null;
  bill: Bill;
};

export type MyShowsData = {
  exhibitor: { id: string; full_name: string } | null;
  shows: MyShow[];
};

export const SHOW_STATUS_BADGE: Record<
  string,
  { label: string; bgColor: string; textColor: string }
> = {
  ACTIVE: { label: 'In Progress', bgColor: '#fef3c7', textColor: '#92400e' },
  PUBLISHED: { label: 'Open for Registration', bgColor: '#dbeafe', textColor: '#1e40af' },
  COMPLETED: { label: 'Completed', bgColor: '#f3f4f6', textColor: '#6b7280' },
  DRAFT: { label: 'Draft', bgColor: '#f3f4f6', textColor: '#6b7280' },
};

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const yr = e.getFullYear();
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (s.toDateString() === e.toDateString()) return `${mo(s)}, ${yr}`;
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
    return `${mo(s)}–${e.getDate()}, ${yr}`;
  return `${mo(s)} – ${mo(e)}, ${yr}`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'];
  return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]);
}

/** A show is history once it can no longer be registered for or competed in. */
export function isPastShow(show: MyShow): boolean {
  return !['ACTIVE', 'PUBLISHED'].includes(show.show_status);
}
