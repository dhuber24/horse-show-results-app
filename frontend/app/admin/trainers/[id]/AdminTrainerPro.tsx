'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import GrantTermPicker from '@/components/GrantTermPicker';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import { GRANT_LABELS, type GrantKind, type TrainerBilling } from '@/lib/subscriptions';
import { formatDay, PRO_NO_END, proPlanLabel, proThrough, type ProPlan } from '@/lib/trainer-registry';

interface ProTrainer {
  id: string;
  is_public: boolean;
  is_pro: boolean;
  pro_until: string | null;
  pro_plan: ProPlan | null;
  pro_grant?: GrantKind | null;
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
 *
 * It is also where Pro is given away (migration 179: a comp or a free trial) and
 * where a card subscription is stopped: read live from Stripe, because the
 * trainer can change it on Stripe's own page. *End Pro* ends the card as well,
 * since a subscription left running would go on charging and turn Pro back on.
 */
export default function AdminTrainerPro({ trainer }: { trainer: ProTrainer }) {
  const router = useRouter();
  const startPlan: ProPlan = trainer.pro_request_plan ?? trainer.pro_plan ?? 'monthly';
  const [plan, setPlan] = useState<ProPlan>(startPlan);
  const noEnd = trainer.pro_until === PRO_NO_END;
  const [until, setUntil] = useState(noEnd ? '' : trainer.pro_until ?? '');
  // "One period from today" is the browser's today, set after hydration: the
  // server renders in UTC, which is tomorrow for every US evening.
  useEffect(() => {
    setUntil(noEnd ? '' : trainer.pro_until ?? periodFromToday(startPlan));
  }, [trainer.pro_until, noEnd, startPlan]);
  const [billing, setBilling] = useState<TrainerBilling | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const loadBilling = useCallback(async () => {
    const res = await fetch(`/api/subscriptions/trainers/${trainer.id}/billing`).catch(() => null);
    if (!res?.ok) {
      setBillingFailed(true);
      return;
    }
    setBillingFailed(false);
    setBilling(await res.json().catch(() => null));
  }, [trainer.id]);
  useEffect(() => {
    void loadBilling();
  }, [loadBilling, trainer.pro_until, trainer.pro_grant]);
  const [confirmRenewal, setConfirmRenewal] = useState(false);
  const [giving, setGiving] = useState(false);
  const [grantKind, setGrantKind] = useState<GrantKind>('trial');
  const [grantEnds, setGrantEnds] = useState<string | null>('');
  const [grantNote, setGrantNote] = useState('');
  const paysByCard = billing?.pays_by_card ?? false;
  // From the billing read as well as the row: the trainer's own admin page reads
  // a list any signed-in account can, which doesn't carry it.
  const grant = trainer.pro_grant ?? billing?.pro_grant ?? null;
  const prices = billing?.pro_prices;
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

  const setRenewal = async (renews: boolean) => {
    setConfirmRenewal(false);
    await call(
      `/api/subscriptions/trainers/${trainer.id}/billing/renewal`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renews }) },
      renews ? 'The card subscription renews again.' : 'It won\'t renew. Pro stays on through the date paid for.',
    );
    await loadBilling();
  };

  const give = async () => {
    await call(
      `/api/subscriptions/trainers/${trainer.id}/grant`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: grantKind, ends_on: grantEnds, note: grantNote.trim() || null }),
      },
      grantKind === 'trial' ? 'Free trial started.' : 'Comp given.',
    );
    setGiving(false);
    setGrantNote('');
  };

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
            {grant ? ` (${GRANT_LABELS[grant].toLowerCase()})` : ''}
            {trainer.pro_plan ? ` (${proPlanLabel(trainer.pro_plan, prices)})` : ''} {proThrough(trainer.pro_until)}.
          </>
        ) : trainer.pro_until ? (
          <>Basic. Pro ran through {formatDay(trainer.pro_until)}.</>
        ) : (
          <>Basic.</>
        )}
        {!trainer.is_public && ' Not listed in the registry, so neither plan shows anywhere yet.'}
      </p>

      {grant && billing?.pro_grant_note && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{billing.pro_grant_note}</p>
      )}

      {billingFailed && (
        <p className="text-sm" style={{ color: 'var(--error-strong)' }}>How this trainer pays could not be loaded.</p>
      )}

      {paysByCard && billing && (
        <div className="rounded border p-3 text-sm space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
          <p>
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Paying by card through Stripe.</span>{' '}
            {!billing.can_manage
              ? 'Online payment is not set up here, so manage it in the Stripe dashboard.'
              : billing.read_failed
                ? 'Stripe could not be reached just now, so whether it renews is not known.'
                : billing.renews
                  ? `Renews${billing.period_end ? ` on ${formatDay(billing.period_end)}` : ''}.`
                  : `Won't renew${billing.period_end ? `; paid through ${formatDay(billing.period_end)}` : ''}.`}
          </p>
          {billing.can_manage && !billing.read_failed && (
            billing.renews ? (
              confirmRenewal ? (
                <span className="flex flex-wrap items-center gap-2">
                  Stop it renewing? Pro stays on through the date paid for, and the trainer is emailed.
                  <button type="button" disabled={busy} onClick={() => setRenewal(false)} className="font-medium hover:underline" style={{ color: 'var(--error-strong)' }}>
                    Yes, stop it
                  </button>
                  <button type="button" onClick={() => setConfirmRenewal(false)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmRenewal(true)} className="hover:underline" style={{ color: 'var(--error-strong)' }}>
                  Stop renewing
                </button>
              )
            ) : (
              <button type="button" disabled={busy} title={busy ? 'Working…' : undefined} onClick={() => setRenewal(true)} className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                Turn renewal back on
              </button>
            )
          )}
        </div>
      )}

      {trainer.pro_request_plan && (
        <div className="rounded border p-3 text-sm space-y-2" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}>
          <p>
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Asked for Pro</span>, {proPlanLabel(trainer.pro_request_plan, prices)}
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
            <option value="monthly">Monthly — {proPlanLabel('monthly', prices)}</option>
            <option value="annual">Annual — {proPlanLabel('annual', prices)}</option>
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
            <span className="text-sm flex flex-wrap items-center gap-2" style={{ color: 'var(--text-deep)' }}>
              {paysByCard
                ? 'End Pro and cancel the card subscription today? Nothing is refunded; make any refund in Stripe.'
                : 'End Pro now?'}
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
      <div className="border-t pt-3 space-y-3" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          aria-expanded={giving}
          onClick={() => setGiving((v) => !v)}
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {giving ? 'Close' : grant && trainer.is_pro ? 'Change the comp or trial' : 'Give Pro free: a comp or trial'}
        </button>
        {giving && (
          <div className="space-y-3">
            <div>
              <label htmlFor={`trainer-grant-kind-${trainer.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Give</label>
              <select
                id={`trainer-grant-kind-${trainer.id}`}
                value={grantKind}
                onChange={(e) => setGrantKind(e.target.value as GrantKind)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="trial">A free trial</option>
                <option value="comp">A comp (complimentary)</option>
              </select>
            </div>
            <GrantTermPicker allowNoEnd={grantKind === 'comp'} onChange={setGrantEnds} idPrefix={`trainer-grant-${trainer.id}`} />
            <div>
              <label htmlFor={`trainer-grant-note-${trainer.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
                Why (only GaitDesk admins see this)
              </label>
              <input
                id={`trainer-grant-note-${trainer.id}`}
                value={grantNote}
                maxLength={500}
                onChange={(e) => setGrantNote(e.target.value)}
                className={`${inputClass} w-full`}
                style={inputStyle}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Starts today. The trainer is emailed, and reminded a week before it ends. It answers a request for Pro.
              {paysByCard && ' Their card must stop renewing first.'}
            </p>
            <button
              type="button"
              disabled={busy || grantEnds === ''}
              title={grantEnds === '' ? 'Choose the last day' : busy ? 'Working…' : undefined}
              onClick={give}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              {busy ? 'Working…' : grantKind === 'trial' ? 'Start the trial' : 'Give the comp'}
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>{message.text}</p>
      )}
    </section>
  );
}
