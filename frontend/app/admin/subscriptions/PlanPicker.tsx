'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { PRO_PLUS, type ColumnPlanKey, type PlanKey, type ShowCompany } from '@/lib/show-companies';
import { planChoiceIsNoChange, planChoiceTitle, planOnToday } from '@/lib/subscriptions';

const CHOICES: { key: PlanKey; label: string }[] = [
  { key: 'free', label: 'Free' },
  { key: 'basic', label: 'Basic' },
  { key: 'pro', label: 'Pro' },
  { key: PRO_PLUS, label: 'Pro+' },
];

/**
 * Moving a company to Free, Basic or Pro (migration 168) -- the one way an
 * admin does it, from a row's buttons and the plan cards under it alike, so
 * both behave the same.
 *
 * **Immediate both ways**: moving a company to Basic keeps all its work, which
 * comes back with Pro, so a confirmation would only slow a fix. Moving it to Pro answers its upgrade requests, server-side.
 * `pending` is the plan just pressed, so the choice shows on the press and
 * settles on the company the endpoint returns.
 */
export function usePlanChange(
  company: ShowCompany,
  onChange: (company: ShowCompany) => void,
  onError: (message: string | null) => void,
) {
  const [pending, setPending] = useState<ColumnPlanKey | null>(null);

  async function choose(plan: ColumnPlanKey) {
    // While Pro+ renews, the plan the company already holds is still a choice:
    // pressing it stops the renewal (migration 175).
    if ((plan === company.plan && !company.renews_pro_plus) || pending) return;
    setPending(plan);
    onError(null);
    const res = await fetch(`/api/show-companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (res?.ok) onChange(body as ShowCompany);
    else {
      const label = CHOICES.find((c) => c.key === plan)?.label ?? plan;
      onError(errorMessage(body, `${company.name} could not be moved to GaitDesk ${label}.`));
    }
    setPending(null);
  }

  return { pending, choose };
}

/**
 * Which GaitDesk plan a company is on, as a row's control on Manage
 * Subscriptions. The button lit is what it is on today (`planOnToday`), Pro+
 * included; during a Pro+ year or a comp or trial, Free, Basic and Pro say what
 * follows it, and the row's own line says which.
 *
 * **Pro+ is a button like the others, but opens the form that starts a year**
 * (`onProPlus`) rather than moving the company on the press: a year has a payment
 * to record, and started on credit it issues an invoice and emails the company's
 * managers, which is too much for one misplaced click.
 */
export default function PlanPicker({
  company,
  onChange,
  onError,
  onProPlus,
}: {
  company: ShowCompany;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
  onProPlus: () => void;
}) {
  const { pending, choose } = usePlanChange(company, onChange, onError);
  const current = pending ?? planOnToday(company);
  const lapsed = Boolean(company.pro_plus_lapsed_since);

  return (
    <div
      role="radiogroup"
      aria-label={`GaitDesk plan for ${company.name}`}
      className="inline-flex rounded-lg border p-0.5"
      style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-subtle)' }}
    >
      {CHOICES.map((choice) => {
        const on = current === choice.key;
        const isProPlus = choice.key === PRO_PLUS;
        const accented = choice.key === 'pro' || isProPlus;
        return (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => (isProPlus ? onProPlus() : choose(choice.key as ColumnPlanKey))}
            disabled={pending !== null || planChoiceIsNoChange(company, choice.key)}
            title={pending !== null ? 'Saving…' : planChoiceTitle(company, choice.key, choice.label)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              pending !== null ? 'disabled:cursor-wait' : 'disabled:cursor-default'
            }`}
            style={
              on && isProPlus && lapsed
                ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }
                : on
                  ? { backgroundColor: accented ? 'var(--accent)' : 'var(--surface)', color: accented ? 'var(--accent-foreground)' : 'var(--foreground)' }
                  : { color: 'var(--muted)' }
            }
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
