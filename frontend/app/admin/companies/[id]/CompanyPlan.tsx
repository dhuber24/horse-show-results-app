'use client';

import { useState } from 'react';
import {
  PRO_PLUS,
  formatDay,
  formatRate,
  type ColumnPlanKey,
  type PlanInfo,
  type ShowCompany,
} from '@/lib/show-companies';
import PlanPicker, { usePlanChange } from '../PlanPicker';
import ProPlusYears from './ProPlusYears';

function priceText(plan: PlanInfo): string {
  return plan.annual_cents
    ? `${formatRate(plan.annual_cents)} / year`
    : plan.rate_cents
      ? `${formatRate(plan.rate_cents)} / exhibitor`
      : 'no charge';
}

/**
 * A company's plan on its admin page: one card per plan in the backend's
 * `PLANS`, and **the card is the control**. Free, Basic and Pro move the
 * company the moment one is pressed, exactly as the list's picker does
 * (`usePlanChange`). Pro+ is a year with a payment to record, so its card
 * opens the form that starts one (`ProPlusYears`), and the years sit under
 * the cards.
 *
 * **Pro+ renews as Pro+** (migration 175): during a year only the Pro+ card
 * is marked while the company renews it, and pressing Basic or Pro makes
 * that plan follow the year instead (marked *After Pro+*). Once a renewing
 * year has ended unpaid the Pro+ card says so and the company is frozen; a
 * Basic or Pro card moves it at once and unfreezes it, and the Pro+ card
 * starts the renewal, backdated to the day after the year ended.
 */
export default function CompanyPlan({
  company,
  plans,
  onChange,
  onError,
}: {
  company: ShowCompany;
  plans: PlanInfo[];
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const { pending, choose } = usePlanChange(company, onChange, onError);
  const [startingYear, setStartingYear] = useState(false);
  const onProPlus = company.effective_plan === PRO_PLUS;
  const renews = company.renews_pro_plus === true;
  const lapsedSince = company.pro_plus_lapsed_since ?? null;
  const columnPlan = pending ?? company.plan;
  const proPlus = plans.find((p) => p.key === PRO_PLUS);
  const yearEnds = [...(company.subscriptions ?? [])].sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0]?.ends_on;

  function tag(plan: PlanInfo, isColumn: boolean): string | null {
    if (plan.key === PRO_PLUS) {
      if (lapsedSince) return 'Renewal unpaid';
      return onProPlus ? `Through ${formatDay(yearEnds)}${renews ? ' · renews' : ''}` : null;
    }
    if (isColumn && pending) return 'Saving…';
    if (isColumn) return onProPlus ? 'After Pro+' : 'Current plan';
    return null;
  }

  function title(plan: PlanInfo, isColumn: boolean): string {
    if (plan.key === PRO_PLUS) {
      if (startingYear) return 'Close the form';
      if (lapsedSince) return 'Start the renewal — it picks up the day after the last year ended, and unfreezes its shows';
      return onProPlus
        ? 'Start the next Pro+ year — it begins the day after this one ends'
        : 'Start a Pro+ year: payment received, invoiced later or complimentary';
    }
    if (pending) return 'Saving…';
    if (isColumn) {
      return onProPlus
        ? `${company.name} moves to ${plan.label} when its Pro+ year runs out`
        : `${company.name} is on ${plan.label}`;
    }
    if (lapsedSince) return `Move ${company.name} to ${plan.label} — its shows unfreeze at once`;
    return onProPlus
      ? `Follow ${company.name}'s Pro+ year with ${plan.label}${renews ? ' instead of renewing Pro+' : ''}`
      : `Move ${company.name} to ${plan.label}`;
  }

  return (
    <section
      className="p-5 rounded-lg border space-y-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>Plan</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {lapsedSince
            ? `Pro+ renewal unpaid since ${formatDay(lapsedSince)}: the company sets up no show, and its shows that hadn't finished by then are frozen until it renews or moves to Basic or Pro. `
            : onProPlus && renews
              ? `On ${company.effective_plan_label} through ${formatDay(yearEnds)}. It renews as Pro+, and its shows freeze if the renewal isn't paid. `
            : onProPlus
            ? `On ${company.effective_plan_label} through ${formatDay(yearEnds)}; ${company.plan_label} after that. `
            : company.plan === 'free'
              ? 'GaitDesk Free: the company can staff itself but set up no show until it picks Basic or Pro. '
              : `${company.plan_label}, at ${formatRate(company.plan_rate_cents)} per exhibitor registered to each of its shows. `}
          The company picks Basic or Pro itself on My Company. Click a plan to move it here: the change reaches
          every account below and every show it runs straight away, is logged for pricing, and emails its show
          managers. Pro+ opens a form to start a paid year.
        </p>
      </div>

      {plans.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {plans.map((plan) => {
            const isProPlus = plan.key === PRO_PLUS;
            // While Pro+ renews, no other plan is the company's choice -- until one is pressed.
            const isColumn = !isProPlus && plan.key === columnPlan && (!renews || pending !== null);
            const current = isProPlus ? onProPlus : isColumn && !onProPlus;
            const warn = isProPlus && lapsedSince !== null;
            const label = tag(plan, isColumn);
            return (
              <button
                key={plan.key}
                type="button"
                onClick={() => (isProPlus ? setStartingYear((open) => !open) : choose(plan.key as ColumnPlanKey))}
                disabled={!isProPlus && (pending !== null || isColumn)}
                aria-pressed={isProPlus ? undefined : isColumn}
                aria-expanded={isProPlus ? startingYear : undefined}
                aria-controls={isProPlus ? 'pro-plus-year-form' : undefined}
                title={title(plan, isColumn)}
                className={`rounded-lg border p-3 text-left flex flex-col transition-colors disabled:cursor-default ${
                  current || isColumn || warn ? '' : 'border-border-subtle hover:border-border-strong'
                }`}
                style={{
                  ...(warn
                    ? { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }
                    : current
                    ? { borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }
                    : isColumn
                      ? { borderColor: 'var(--accent-border)', backgroundColor: 'var(--background)' }
                      : { backgroundColor: 'var(--background)' }),
                }}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                    {plan.label}
                    <span className="ml-2 font-normal" style={{ color: 'var(--muted)' }}>{priceText(plan)}</span>
                  </span>
                  {label && (
                    <span
                      className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded"
                      style={
                        warn
                          ? { backgroundColor: 'var(--surface)', color: 'var(--warning-strong)' }
                          : current
                          ? { backgroundColor: 'var(--surface)', color: 'var(--accent)' }
                          : { backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }
                      }
                    >
                      {label}
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block space-y-0.5 text-xs list-disc pl-4 flex-1" style={{ color: 'var(--text-deep)' }}>
                  {plan.includes.map((line) => (
                    <span key={line} className="list-item">{line}</span>
                  ))}
                </span>
                {isProPlus && (
                  <span className="mt-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                    {startingYear
                      ? 'Fill in the year below'
                      : lapsedSince
                        ? 'Start the renewal…'
                        : onProPlus
                          ? 'Start the next year…'
                          : 'Start a year…'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        // The plans ride on the caller's features; without them there is
        // nothing to draw a card from, so the list's picker stands in.
        <div className="flex items-center gap-4 flex-wrap">
          <PlanPicker company={company} onChange={onChange} onError={onError} />
          <button
            type="button"
            onClick={() => setStartingYear((open) => !open)}
            aria-expanded={startingYear}
            aria-controls="pro-plus-year-form"
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Start a Pro+ year
          </button>
        </div>
      )}

      <ProPlusYears
        company={company}
        plan={proPlus}
        open={startingYear}
        onClose={() => setStartingYear(false)}
        onChange={onChange}
        onError={onError}
      />
    </section>
  );
}
