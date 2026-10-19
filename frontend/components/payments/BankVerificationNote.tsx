/**
 * A bank account typed in by hand, rather than linked by signing in to the
 * bank, is checked with a microdeposit before the payment goes ahead: Stripe
 * sends the account a small deposit, and the payer enters its code on
 * Stripe's own page. Until then the payment is on its way, like any bank
 * payment, and nothing else is paid in the meantime.
 */
export default function BankVerificationNote({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
      One more step: Stripe sends your bank account a small deposit within 1–2 business days. Enter the code from it on{' '}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
        style={{ color: 'var(--accent)' }}
      >
        Stripe&apos;s verification page
      </a>{' '}
      to finish paying. Keep this link — the payment goes through only once the code is entered.
    </p>
  );
}
