'use client';

import { useState } from 'react';
import GrantTermPicker from '@/components/GrantTermPicker';
import { errorMessage } from '@/lib/api-error';
import { formatDay, formatRate, type CompanyGrant, type ShowCompany } from '@/lib/show-companies';
import { GRANT_LABELS, type CompanyGrantKind } from '@/lib/subscriptions';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

const PLAN_LABELS: Record<string, string> = { basic: 'GaitDesk Basic', pro: 'GaitDesk Pro' };

/** A grant in a few words, for its line in the list. */
function grantLine(grant: CompanyGrant): string {
  const plan = PLAN_LABELS[grant.plan] ?? grant.plan;
  return grant.kind === 'upgrade' ? `Free upgrade to ${plan}` : `${plan}, ${GRANT_LABELS[grant.kind].toLowerCase()}`;
}

/** What an upgrade does for this company, by the plan it pays for. */
function upgradeNote(company: ShowCompany): string {
  if (company.plan === 'basic') {
    return `${company.name} pays for GaitDesk Basic, at ${formatRate(company.plan_rate_cents)} per exhibitor, and goes on paying it.`;
  }
  if (company.plan === 'free') return `${company.name} is on GaitDesk Free, so it applies once the company chooses Basic.`;
  return `${company.name} already pays for GaitDesk Pro, so this changes nothing unless it moves to Basic.`;
}

/**
 * Giving a company a plan for free (migration 179): a comp, which may have no
 * end, or a trial, which does. While one runs the company is on that plan and a
 * show starting then costs nothing per exhibitor; when it ends the company is on
 * the plan it chose, which this leaves alone. Pro at no charge has everything
 * Pro+ has, so there is no Pro+ here.
 *
 * Or **an upgrade** (migration 188): Pro's features while the company still
 * pays for its own plan, so a company on Basic is billed Basic and has every Pro
 * screen. It is always to Pro, and may have no end, as a comp may.
 */
export default function CompanyGrants({
  company,
  onChange,
  onError,
}: {
  company: ShowCompany;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<CompanyGrantKind>('trial');
  const [plan, setPlan] = useState<'basic' | 'pro'>('pro');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState<string | null>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const grants = [...(company.grants ?? [])].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const missingEnd = endsOn === '';

  async function send(url: string, init: RequestInit, fallback: string): Promise<boolean> {
    setBusy(true);
    onError(null);
    const res = await fetch(url, init).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      onError(errorMessage(body, fallback));
      return false;
    }
    onChange(body as ShowCompany);
    return true;
  }

  async function give() {
    const done = await send(
      `/api/subscriptions/companies/${company.id}/grants`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: kind === 'upgrade' ? 'pro' : plan,
          kind,
          starts_on: startsOn || null,
          ends_on: endsOn,
          note: note.trim() || null,
        }),
      },
      'The plan could not be given.',
    );
    if (done) {
      setFormOpen(false);
      setNote('');
      setStartsOn('');
    }
  }

  async function end(grantId: string) {
    await send(`/api/subscriptions/companies/${company.id}/grants/${grantId}/end`, { method: 'POST' }, 'It could not be ended.');
    setConfirmEnd(null);
  }

  return (
    <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Comps, free trials and upgrades</h3>
        <button
          type="button"
          aria-expanded={formOpen}
          onClick={() => setFormOpen((v) => !v)}
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {formOpen ? 'Close' : 'Give a comp, trial or upgrade'}
        </button>
      </div>

      {grants.length > 0 && (
        <ul className="space-y-1.5">
          {grants.map((grant) => {
            const active = grant.id === company.active_grant_id;
            const ended = !active && grant.ends_on !== null && grant.starts_on <= new Date().toISOString().slice(0, 10);
            return (
              <li key={grant.id} className="text-sm flex flex-wrap items-center justify-between gap-2" style={{ color: 'var(--text-deep)' }}>
                <span suppressHydrationWarning>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {grantLine(grant)}
                  </span>
                  {' '}{formatDay(grant.starts_on)}{grant.ends_on ? ` to ${formatDay(grant.ends_on)}` : ', no end date'}
                  {active && <span style={{ color: 'var(--success-strong)' }}> · running</span>}
                  {ended && <span style={{ color: 'var(--muted)' }}> · ended</span>}
                  {grant.note && <span style={{ color: 'var(--muted)' }}> · {grant.note}</span>}
                </span>
                {!ended &&
                  (confirmEnd === grant.id ? (
                    <span className="flex items-center gap-2">
                      End it now?
                      <button type="button" disabled={busy} onClick={() => end(grant.id)} className="font-medium hover:underline" style={{ color: 'var(--error-strong)' }}>
                        Yes, end it
                      </button>
                      <button type="button" onClick={() => setConfirmEnd(null)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmEnd(grant.id)} className="hover:underline" style={{ color: 'var(--error-strong)' }}>
                      End
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {formOpen && (
        <div className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`grant-kind-${company.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Give</label>
              <select
                id={`grant-kind-${company.id}`}
                value={kind}
                onChange={(e) => setKind(e.target.value as CompanyGrantKind)}
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              >
                <option value="trial">A free trial</option>
                <option value="comp">A comp (complimentary)</option>
                <option value="upgrade">A free upgrade (still pays for its plan)</option>
              </select>
            </div>
            {kind === 'upgrade' ? (
              <p className="text-sm py-2" style={{ color: 'var(--text-deep)' }}>to GaitDesk Pro</p>
            ) : (
              <div>
                <label htmlFor={`grant-plan-${company.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Of</label>
                <select
                  id={`grant-plan-${company.id}`}
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as 'basic' | 'pro')}
                  className="border rounded px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="pro">GaitDesk Pro</option>
                  <option value="basic">GaitDesk Basic</option>
                </select>
              </div>
            )}
            <div>
              <label htmlFor={`grant-start-${company.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Starting</label>
              <input
                id={`grant-start-${company.id}`}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
                style={inputStyle}
              />
            </div>
          </div>
          <GrantTermPicker
            allowNoEnd={kind !== 'trial'}
            from={startsOn || undefined}
            onChange={setEndsOn}
            idPrefix={`grant-${company.id}`}
          />
          <div>
            <label htmlFor={`grant-note-${company.id}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
              Why (only GaitDesk admins see this)
            </label>
            <input
              id={`grant-note-${company.id}`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full"
              style={inputStyle}
            />
          </div>
          {kind === 'upgrade' ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Starts today if left blank. While it runs the company has every GaitDesk Pro feature, and each show is
              billed at its own plan as usual. {upgradeNote(company)} It doesn&apos;t unfreeze an unpaid Pro+ renewal.
              The company&apos;s show managers are emailed, and reminded a week before it ends.
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Starts today if left blank. A date in the past comps shows already run, though an invoice already issued
              stands until it is voided. No show that starts while it runs is charged per exhibitor. The company&apos;s
              show managers are emailed, and reminded a week before it ends. Afterwards it is on{' '}
              {company.plan_label}; a Pro+ show or year is not affected.
            </p>
          )}
          <button
            type="button"
            disabled={busy || missingEnd}
            title={missingEnd ? 'Choose the last day' : busy ? 'Working…' : undefined}
            onClick={give}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {busy ? 'Working…' : kind === 'trial' ? 'Start the trial' : kind === 'upgrade' ? 'Give the upgrade' : 'Give the comp'}
          </button>
        </div>
      )}
    </div>
  );
}
