import Link from 'next/link';
import { SHOWBILL_IMPORT, upgradeText, type MyFeatures } from '@/lib/show-companies';

/**
 * What the show-bill screens show a caller whose show company is not on the
 * plan (migration 142) -- the same words as the locked button on
 * `AutomateShowCard`, and always the way the show can still be set up, so the
 * screen is never a dead end.
 */
export default function PaidFeatureNotice({ mine }: { mine: MyFeatures }) {
  const { headline, detail } = upgradeText(mine, SHOWBILL_IMPORT);
  return (
    <div
      className="rounded-lg border p-4 text-sm space-y-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
    >
      <p>
        <span className="font-semibold">{headline}</span>{' '}
        <span style={{ color: 'var(--muted)' }}>{detail}</span>
      </p>
      <p>
        <Link href="/admin/shows/new" className="underline" style={{ color: 'var(--primary)' }}>
          Set the show up step by step instead →
        </Link>
      </p>
    </div>
  );
}
