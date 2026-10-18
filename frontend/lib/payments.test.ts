// Globals are imported rather than declared ambiently: see api-error.test.ts.
import { describe, expect, it } from '@jest/globals';

import { cardFeeNotice, cardRateLabel, formatCents, quoteMethodLabel } from './payments';

describe('payments', () => {
  it('names the card rate the way Stripe prices it', () => {
    expect(cardRateLabel(290, 30)).toBe('2.9% + 30¢');
    expect(cardRateLabel(300, 0)).toBe('3%');
    expect(cardRateLabel(275, 25)).toBe('2.75% + 25¢');
  });

  it('warns about the card fee only when the payee passes it on', () => {
    expect(cardFeeNotice({ pass_card_fees: false, card_fee_cap_bp: 300 })).toBeNull();
    expect(cardFeeNotice({ pass_card_fees: true, card_fee_cap_bp: 300 })).toBe(
      'Paying by credit card adds a card processing fee of up to 3%. Debit cards and bank transfers add nothing.',
    );
  });

  it('says how the total is being paid', () => {
    const quote = { amount_cents: 100, card_fee_cents: 0, total_cents: 100, card_funding: null, method_type: null };
    expect(quoteMethodLabel({ ...quote, method_type: 'card', card_funding: 'credit' })).toBe('credit card');
    expect(quoteMethodLabel({ ...quote, method_type: 'card', card_funding: 'unknown' })).toBe('card');
    expect(quoteMethodLabel({ ...quote, method_type: 'us_bank_account' })).toBe('bank transfer');
  });

  it('prints cents as dollars', () => {
    expect(formatCents(149_900)).toBe('$1,499.00');
  });
});
