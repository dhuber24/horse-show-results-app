'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import { formatDay, proPlanLabel, type ProPlan } from '@/lib/trainer-registry';

interface ProTrainer {
  id: string;
  is_public: boolean;
  is_pro: boolean;
  pro_until: string | null;
  pro_plan: ProPlan | null;
  pro_request_plan: ProPlan | null;
  pro_requested_at: string | null;
}

/** A plan's paid-through date, one billing period on from today. */
function periodFromToday(plan: ProPlan): string {
  const d = new Date();
  if (plan === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Trainer Registry Pro, from the admin's side. A trainer who subscribes by
 * card (migration 172) has their date moved by each payment; for anybody else
 * — or with online payment not set up — the trainer asks, an admin bills them
 * outside the app and records here how long they have paid for. Pro is on through that date and Basic after it
 * — nobody has to switch it off. Recording a date answers the request.
 */
export default function AdminTrainerPro({ trainer }: { trainer: ProTrainer }) {
  const router = useRouter();
  const startPlan: ProPlan = trainer.pro_request_plan ?? trainer.pro_plan ?? 'monthly';
  const [plan, setPlan] = useState<ProPlan>(startPlan);
  const [until, setUntil] = useState(trainer.pro_until ?? '');
  // "One period from today" is the browser's today, set after hydration: the
  // server renders in UTC, which is tomorrow for every US evening.
  useEffect(() => {
    if (!trainer.pro_until) setUntil(periodFromToday(startPlan));
  }, [trainer.pro_until, startPlan]);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const call = async (url: string, init: RequestInit, done: string) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, init).catch(() => null);
    setBusy(false);
    setConfirmEnd(false);
    if (!res || (!res.ok && res.status !== 204)) {
      const body = res ? await res.json().catch(() => null) : null;
      setMessage({ ok: false, text: errorMessage(body, 'Something went wrong.') });
      return;
    }
    setMessage({ ok: true, text: done });
    router.refresh();
  };

  const save = (pro_until: string | null) =>
    call(
      `/api/trainers/${trainer.id}/pro`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pro_until, pro_plan: pro_until ? plan : null }) },
      pro_until ? `Pro recorded through ${formatDay(pro_until)}.` : 'Pro ended. The listing is on Basic.',
    );

  const inputClass = 'border rounded px-3 py-2 text-sm focus:outline-none';
  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

  return (
    <section
      className="rounded-lg border p-5 space-y-3"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: trainer.pro_request_plan ? 'var(--warning-border)' : 'var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Trainer Registry plan</h2>
        <Link href="/trainers/plans" target="_blank" rel="noopener" className="text-xs underline" style={{ color: 'var(--accent)' }}>
          Compare plans
        </Link>
      </div>

      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
        {trainer.is_pro ? (
          <>
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Pro</span>
            {trainer.pro_plan ? ` (${proPlanLabel(trainer.pro_plan)})` : ''} through {formatDay(trainer.pro_until)}.
          </>
        ) : trainer.pro_until ? (
          <>Basic. Pro ran through {formatDay(trainer.pro_until)}.</>
        ) : (
          <>Basic.</>
        )}
        {!trainer.is_public && ' Not listed in the registry, so neither plan shows anywhere yet.'}
      </p>

      {trainer.pro_request_plan && (
        <div className="rounded border p-3 text-sm space-y-2" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}>
          <p>
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Asked for Pro</span>, {proPlanLabel(trainer.pro_request_plan)}
            {trainer.pro_requested_at && (
              <>
                {' '}on <LocalTime iso={trainer.pro_requested_at} format={{ month: 'short', day: 'numeric', year: 'numeric' }} />
              </>
            )}
            . Bill them, then record the paid-through date below — that answers the request.
          </p>
          <button
            type="button"
            disabled={busy}
            title={busy ? 'Working…' : undefined}
            onClick={() => call(`/api/trainers/${trainer.id}/pro-request`, { method: 'DELETE' }, 'Request dismissed.')}
            className="text-xs hover:underline disabled:opacity-50"
            style={{ color: 'var(--error-strong)' }}
          >
            Dismiss without granting Pro
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="pro-plan" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Plan</label>
          <select
            id="pro-plan"
            value={plan}
            onChange={(e) => {
              const next = e.target.value as ProPlan;
              setPlan(next);
              if (!trainer.is_pro) setUntil(periodFromToday(next));
            }}
            className={inputClass}
            style={inputStyle}
          >
            <option value="monthly">Monthly — {proPlanLabel('monthly')}</option>
            <option value="annual">Annual — {proPlanLabel('annual')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="pro-until" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Paid through</label>
          <input id="pro-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <button
          type="button"
          disabled={busy || !until}
          title={!until ? 'Choose the date Pro is paid through' : busy ? 'Working…' : undefined}
          onClick={() => save(until)}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {trainer.is_pro ? 'Update Pro' : 'Record Pro'}
        </button>
        {trainer.pro_until && (
          confirmEnd ? (
            <span className="text-sm flex items-center gap-2" style={{ color: 'var(--text-deep)' }}>
              End Pro now?
              <button type="button" disabled={busy} onClick={() => save(null)} className="font-medium hover:underline" style={{ color: 'var(--error-strong)' }}>
                Yes, end it
              </button>
              <button type="button" onClick={() => setConfirmEnd(false)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmEnd(true)} className="text-sm hover:underline" style={{ color: 'var(--error-strong)' }}>
              End Pro
            </button>
          )
        )}
      </div>
      {message && (
        <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>{message.text}</p>
      )}
    </section>
  );
}
