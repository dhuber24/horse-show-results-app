'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { ColumnPlanKey, ShowCompany } from '@/lib/show-companies';

// Pro+ is not here: it is a paid year, recorded on the company's page.
const CHOICES: { key: ColumnPlanKey; label: string }[] = [
  { key: 'free', label: 'Free' },
  { key: 'basic', label: 'Basic' },
  { key: 'pro', label: 'Pro' },
];

/**
 * Moving a company to Free, Basic or Pro (migration 168) -- the one way an
 * admin does it, from the list's picker and the company page's plan cards
 * alike, so both behave the same.
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

/** Which GaitDesk plan a company is on, as a row's control on the list. */
export default function PlanPicker({
  company,
  onChange,
  onError,
}: {
  company: ShowCompany;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const { pending, choose } = usePlanChange(company, onChange, onError);
  // A company renewing Pro+ has chosen none of these (migration 175).
  const current = pending ?? (company.renews_pro_plus ? null : company.plan);

  return (
    <div
      role="radiogroup"
      aria-label={`GaitDesk plan for ${company.name}`}
      className="inline-flex rounded-lg border p-0.5"
      style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-subtle)' }}
    >
      {CHOICES.map((choice) => {
        const on = current === choice.key;
        return (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(choice.key)}
            disabled={pending !== null}
            title={
              pending !== null
                ? 'Saving…'
                : on
                  ? `${company.name} is on GaitDesk ${choice.label}`
                  : `Move ${company.name} to GaitDesk ${choice.label}`
            }
            className="px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:cursor-wait"
            style={
              on
                ? { backgroundColor: choice.key === 'pro' ? 'var(--accent)' : 'var(--surface)', color: choice.key === 'pro' ? 'var(--accent-foreground)' : 'var(--foreground)' }
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
