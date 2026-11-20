'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readFilesLabel, type ShowBillImport } from '@/lib/showbill-import';
import CancelUploadButton from './new/from-showbill/CancelUploadButton';

const POLL_MS = 8000;

/**
 * A show bill still being read, or read and not yet made into a show.
 *
 * A read takes minutes, and the office will have gone back to My Shows while
 * it runs -- so the show it is turning into is listed here, above the shows,
 * rather than only on the upload page. Once the show is created it is in the
 * list below like any other, and a read that failed stays on the upload page,
 * where it can be tried again; neither is shown here.
 *
 * Polls while a read is running so "Reading…" turns into "Ready to create"
 * without a refresh, and stops once nothing is pending.
 */
export function inProgress(reads: ShowBillImport[]): ShowBillImport[] {
  return reads.filter((r) => !r.show_id && (r.status === 'pending' || r.status === 'succeeded'));
}

export default function ShowbillReads({ initial }: { initial: ShowBillImport[] }) {
  const [reads, setReads] = useState(() => inProgress(initial));
  const pending = reads.some((r) => r.status === 'pending');

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/show-bill-imports', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body: ShowBillImport[] = await res.json();
        if (!cancelled) setReads(inProgress(body));
      } catch {
        // A new array re-runs this effect, so a network blip retries rather
        // than stopping the polling for good.
        if (!cancelled) setReads((r) => [...r]);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reads, pending]);

  if (reads.length === 0) return null;

  return (
    <section
      className="p-4 rounded-lg border space-y-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      aria-labelledby="showbill-reads-heading"
    >
      <h2 id="showbill-reads-heading" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
        Shows being set up from a show bill
      </h2>
      <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {reads.map((imp) => (
          <li key={imp.id} className="py-2 flex items-center justify-between gap-3 flex-wrap text-sm">
            <div className="min-w-0">
              <div className="truncate" style={{ color: 'var(--foreground)' }}>
                {readFilesLabel(imp)}
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {imp.created_at ? new Date(imp.created_at).toLocaleString() : ''} ·{' '}
                {imp.status === 'pending' ? 'Reading…' : 'Ready to create'}
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <CancelUploadButton
                importId={imp.id}
                label={readFilesLabel(imp)}
                onCancelled={() => setReads((rs) => rs.filter((r) => r.id !== imp.id))}
              />
              <Link
                href={`/admin/shows/new/from-showbill/${imp.id}`}
                className="underline"
                style={{ color: 'var(--primary)' }}
              >
                {imp.status === 'pending' ? 'Check on it →' : 'Create →'}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
