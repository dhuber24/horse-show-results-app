import { describe, expect, it } from '@jest/globals';

import { officeBillRows } from './OfficeBillBreakdown';
import type { Bill, BillClassLine } from '@/lib/my-shows';

function classLine(over: Partial<BillClassLine>): BillClassLine {
  return {
    entry_id: 'e',
    class_id: 'c',
    class_number: '1',
    class_name: 'Class',
    class_date: '2026-06-13',
    horse_name: 'Doc',
    fee_cents: 0,
    list_fee_cents: 0,
    sanction_cents: 0,
    charge_cents: 0,
    charges: [],
    ...over,
  };
}

// A bill with every kind of rolled-up line: classes charged one by one, a free
// class, two classes an All Day fee covered, a per-class club sanction, a
// per-class judge assessment, a futurity with every term, and a side pot.
const bill: Bill = {
  class_lines: [
    classLine({
      entry_id: 'e10',
      class_number: '10',
      class_name: 'Western Pleasure',
      fee_cents: 2500,
      list_fee_cents: 2500,
      sanction_cents: 300,
      charge_cents: 500,
      charges: [{ show_fee_id: 'judge', label: 'Judge fee', cents: 500 }],
    }),
    classLine({
      entry_id: 'e2',
      class_number: '2',
      class_name: 'Showmanship',
      fee_cents: 2000,
      list_fee_cents: 2000,
      charge_cents: 500,
      charges: [{ show_fee_id: 'judge', label: 'Judge fee', cents: 500 }],
    }),
    classLine({ entry_id: 'e3', class_number: '3', class_name: 'Walk-Trot', is_free: true }),
    classLine({ entry_id: 'f1', class_number: 'A', class_name: 'Futurity Pleasure', is_futurity: true }),
    classLine({ entry_id: 'f2', class_number: 'B', class_name: 'Futurity Trail', is_futurity: true }),
    classLine({ entry_id: 'f3', class_number: 'C', class_name: 'Futurity Halter', is_futurity: true }),
    classLine({
      entry_id: 'e20',
      class_number: '20',
      class_name: 'Barrels',
      class_date: '2026-06-14',
      list_fee_cents: 3000,
      all_day_fee_id: 'allday',
      all_day_label: 'All Day Speed',
    }),
    classLine({
      entry_id: 'e21',
      class_number: '21',
      class_name: 'Poles',
      class_date: '2026-06-14',
      list_fee_cents: 3000,
      all_day_fee_id: 'allday',
      all_day_label: 'All Day Speed',
    }),
  ],
  all_day_lines: [
    {
      show_fee_id: 'allday',
      code: 'AD',
      label: 'All Day Speed',
      unit: 'all_day_per_horse',
      amount_cents: 5000,
      horse_id: 'h',
      horse_name: 'Doc',
      class_date: null,
      class_count: 2,
      class_fee_cents: 6000,
      line_total_cents: 5000,
    },
  ],
  all_day_total_cents: 5000,
  reservation_lines: [],
  charge_lines: [
    {
      show_fee_id: 'judge',
      code: 'J',
      label: 'Judge fee',
      unit: 'per_entry',
      amount_cents: 500,
      horse_count: 1,
      judge_count: 1,
      entry_count: 2,
      per_class: true,
      quantity: 2,
      line_total_cents: 1000,
    },
  ],
  sanction_lines: [],
  futurity_lines: [
    {
      futurity_id: 'f',
      futurity_name: 'Futurity',
      futurity_entry_id: 'fe',
      horse_id: 'h',
      horse_name: 'Doc',
      fee_tier_name: 'Open',
      tier_amount_cents: 4000,
      class_count: 3,
      is_member: false,
      membership_name: 'Club card',
      membership_fee_cents: 2500,
      office_fee_cents: 1500,
      is_late: true,
      late_fee_cents: 3000,
      entered_at: '2026-06-01',
      entry_ids: ['f1', 'f2', 'f3'],
      line_total_cents: 4000 * 3 + 1500 + 3000 + 2500,
    },
  ],
  side_pot_lines: [{ side_pot_id: 'p', name: 'Barrel 4D', status: 'OPEN', class_count: 1, line_total_cents: 2000 }],
  class_fee_total_cents: 4500,
  class_sanction_total_cents: 300,
  sanction_total_cents: 300,
  reservation_total_cents: 0,
  charge_total_cents: 1000,
  class_charge_total_cents: 1000,
  futurity_total_cents: 19000,
  side_pot_total_cents: 2000,
  adjustment_lines: [],
  adjustment_total_cents: 0,
  total_cents: 4500 + 5000 + 300 + 1000 + 19000 + 2000,
};

describe('officeBillRows', () => {
  const rows = officeBillRows(bill);
  const row = (key: string) => rows.find((r) => r.key === key)!;
  const itemSum = (key: string) => (row(key).items ?? []).reduce((sum, i) => sum + i.cents, 0);

  it('foots to the bill total, side pots included', () => {
    expect(rows.reduce((sum, r) => sum + r.cents, 0)).toBe(bill.total_cents);
    expect(row('pot-p').cents).toBe(2000);
  });

  it('puts every rolled-up line above the single-line fees', () => {
    const firstSingle = rows.findIndex((r) => !r.items?.length);
    expect(firstSingle).toBeGreaterThan(0);
    expect(rows.slice(firstSingle).every((r) => !r.items?.length)).toBe(true);
    expect(rows.slice(firstSingle).map((r) => r.key)).toEqual(['pot-p']);
  });

  it('itemises the class entry fees by class, in day and number order, without the All Day or futurity classes', () => {
    const items = row('classes').items!;
    expect(items.map((i) => i.label)).toEqual(['2 Showmanship', '3 Walk-Trot', '10 Western Pleasure']);
    expect(items[1].amountText).toBe('Free');
    expect(itemSum('classes')).toBe(bill.class_fee_total_cents);
  });

  it('itemises club sanctions and per-class charges so they add up to their line', () => {
    expect(itemSum('class-sanctions')).toBe(300);
    expect(row('class-sanctions').items).toHaveLength(1);
    expect(itemSum('charge-0')).toBe(1000);
    expect(row('charge-0').items).toHaveLength(2);
  });

  it('lists the classes an All Day fee covered at their own prices', () => {
    const items = row('all-day-0').items!;
    expect(items.map((i) => i.label)).toEqual(['20 Barrels', '21 Poles']);
    expect(itemSum('all-day-0')).toBe(6000);
  });

  it('breaks a futurity into its classes at the category rate, then its fees', () => {
    expect(row('futurity-0').items!.map((i) => i.key)).toEqual([
      'class-f1',
      'class-f2',
      'class-f3',
      'office',
      'late',
      'membership',
    ]);
    expect(row('futurity-0').items![0].cents).toBe(4000);
    expect(itemSum('futurity-0')).toBe(bill.futurity_lines[0].line_total_cents);
  });

  it('falls back to one "N × rate" row for a futurity line without entry ids', () => {
    const old = officeBillRows({
      ...bill,
      futurity_lines: [{ ...bill.futurity_lines[0], entry_ids: undefined }],
    });
    const items = old.find((r) => r.key === 'futurity-0')!.items!;
    expect(items[0].key).toBe('tier');
    expect(items.reduce((sum, i) => sum + i.cents, 0)).toBe(bill.futurity_lines[0].line_total_cents);
  });

  it('leaves a line with nothing rolled up in it unexpandable', () => {
    expect(row('pot-p').items).toBeUndefined();
  });
});
