'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import BuyProPlus from '@/components/payments/BuyProPlus';
import { errorMessage } from '@/lib/api-error';
import { PRO_PLUS, formatRate, type CompanyRef, type PlanInfo, type PlanKey } from '@/lib/show-companies';

/**
 * Pick GaitDesk Basic or Pro for a company (migration 169), or ask about Pro+.
 *
 * Where a company on Free meets the wall -- the New Show page -- and where it
 * changes plan later, on My Company. Choosing is **agreeing to the price**,
 * so the box must be ticked; nothing is charged now, and each show is
 * invoiced after it runs. The plans and their prices come from the backend
 * (`show_companies.PLANS`); nothing here spells one.
 *
 * Pro+ is paid for up front (migration 173): with online payment set up the
 * company buys the year here, by bank or card, and it starts when the payment
 * succeeds. Without it the year is asked for, like any upgrade request, and a
 * GaitDesk admin starts it once it is paid.
 */
export default function ChoosePlanPanel({
  companies,
  plans,
  current,
  proPlusRequested = false,
  canBuyOnline = false,
  onChosen,
  heading = 'Choose a plan to set up your show',
  buyProPlusLabel,
}: {
  companies: CompanyRef[];
  plans: PlanInfo[];
  /** The company's current per-exhibitor plan, when there is one company. */
  current?: PlanKey;
  proPlusRequested?: boolean;
  /** Online payment is set up, so Pro+ is bought here rather than asked for. */
  canBuyOnline?: boolean;
  /** Called with the backend's answer; without it the page is refreshed. */
  onChosen?: (body: unknown) => void;
  heading?: string;
  /** The Pro+ button's words -- "Renew Pro+" for a company whose renewal is
   *  unpaid (migration 175). */
  buyProPlusLabel?: string;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(() => companies.find((c) => !c.personal)?.id ?? companies[0]?.id ?? '');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(proPlusRequested);

  const choosable = plans.filter((p) => p.self_serve);
  const proPlus = plans.find((p) => p.key === PRO_PLUS);

  if (companies.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Your account isn&apos;t in a show company yet. Ask GaitDesk to set your company up.
      </p>
    );
  }

  async function choose(plan: PlanKey) {
    setBusy(plan);
    setError(null);
    const res = await fetch(`/api/my-company/${companyId}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, agree }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(null);
    if (!res?.ok) {
      setError(errorMessage(body, 'The plan could not be saved. Try again in a moment.'));
      return;
    }
    setAgree(false);
    if (onChosen) onChosen(body);
    else router.refresh();
  }

  async function askProPlus() {
    setBusy(PRO_PLUS);
    setError(null);
    const res = await fetch('/api/users/me/upgrade-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: PRO_PLUS, company_id: companyId || null }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(null);
    if (!res?.ok) {
      setError(errorMessage(body, 'The request could not be sent. Try again in a moment.'));
      return;
    }
    setAsked(true);
  }

  return (
    <section className="space-y-4" aria-labelledby="choose-plan-heading">
      <div>
        <h2 id="choose-plan-heading" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          {heading}
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Nothing is charged now. Each show is billed after it runs, per exhibitor registered to it, at the plan
          your company was on during the show — and is paid for before you set up the next one.
        </p>
      </div>

      {companies.length > 1 && (
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
          <span className="shrink-0">For</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.personal ? 'My own account' : c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {choosable.map((plan) => {
          const on = plan.key === current;
          return (
            <div
              key={plan.key}
              className="rounded-lg border p-4 flex flex-col gap-3"
              style={{
                borderColor: on ? 'var(--accent-border)' : 'var(--border)',
                backgroundColor: on ? 'var(--accent-bg)' : 'var(--surface)',
              }}
            >
              <div>
                <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {plan.label}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                  <span className="text-xl font-bold tabular-nums">{formatRate(plan.rate_cents)}</span> per exhibitor,
                  per show
                </p>
              </div>
              <ul className="text-xs space-y-0.5 list-disc pl-4 flex-1" style={{ color: 'var(--text-deep)' }}>
                {plan.includes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => choose(plan.key)}
                disabled={on || !agree || busy !== null}
                title={
                  on
                    ? `You're on ${plan.label}`
                    : !agree
                      ? 'Tick the box below to agree to the price first'
                      : busy !== null
                        ? 'Saving…'
                        : `Move to ${plan.label}`
                }
                className="w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
              >
                {on ? 'Your plan' : busy === plan.key ? 'Saving…' : `Choose ${plan.label.replace('GaitDesk ', '')}`}
              </button>
            </div>
          );
        })}
      </div>

      <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
        <span>
          I agree that GaitDesk bills my company, after each show, for every exhibitor registered to it at the
          plan&apos;s price, and that each show is paid for before my company sets up its next one.
        </span>
      </label>

      {proPlus && (
        <div
          className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
              {proPlus.label} — {formatRate(proPlus.annual_cents ?? 0)} a year
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Every Pro feature, unlimited shows and exhibitors, paid for up front for the year. Running more than one
              mid-sized show a season? It usually costs less.
            </p>
          </div>
          {canBuyOnline && companyId ? (
            <BuyProPlus
              key={companyId}
              companyId={companyId}
              label={buyProPlusLabel ?? `Buy ${proPlus.label.replace('GaitDesk ', '')}`}
            />
          ) : asked ? (
            <p role="status" className="text-xs sm:max-w-xs" style={{ color: 'var(--text-deep)' }}>
              Asked. Someone from GaitDesk will contact you to set up your Pro+ year, and we&apos;ll email you when it
              starts.
            </p>
          ) : (
            <button
              type="button"
              onClick={askProPlus}
              disabled={busy !== null}
              title={busy !== null ? 'Sending…' : `Ask GaitDesk about ${proPlus.label}`}
              className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--accent-border)', color: 'var(--accent)' }}
            >
              {busy === PRO_PLUS ? 'Sending…' : `Ask about ${proPlus.label.replace('GaitDesk ', '')}`}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
